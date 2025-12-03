// Poll System - WhatsApp-style interactive polls with progress bars
import { Meteor } from 'meteor/meteor';
import { Rooms, Messages } from '@rocket.chat/models';
import { slashCommands } from '../../utils/server/slashCommand';
import { executeSendMessage } from '../../lib/server/methods/sendMessage';
import { notifyOnMessageChange } from '../../lib/server/lib/notifyListener';

// ============================================================================
// Types
// ============================================================================

interface PollOption {
    id: string;
    text: string;
    votes: number;
    voters: string[];
}

interface Poll {
    id: string;
    question: string;
    options: PollOption[];
    creator: string;
    roomId: string;
    messageId?: string;
    allowMultiple: boolean;
    createdAt: Date;
}

interface OptionStats {
    id: string;
    text: string;
    votes: number;
    percentage: number;
    isSelected: boolean;
}

// In-memory poll storage
const polls = new Map<string, Poll>();

// ============================================================================
// Progress Bar Generator
// ============================================================================

/**
 * Generate a text-based progress bar using Unicode characters
 * @param percentage - 0 to 100
 * @param width - total width in characters
 */
function generateProgressBar(percentage: number, width: number = 20): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    
    // Using block characters for a clean look
    const filledChar = '▓';
    const emptyChar = '░';
    
    return filledChar.repeat(filled) + emptyChar.repeat(empty);
}

// ============================================================================
// Vote Statistics Calculator
// ============================================================================

function calculateVoteStats(poll: Poll, viewerId?: string): { 
    totalVotes: number; 
    options: OptionStats[] 
} {
    const totalVotes = poll.options.reduce((sum, o) => sum + o.votes, 0);
    
    return {
        totalVotes,
        options: poll.options.map(o => ({
            id: o.id,
            text: o.text,
            votes: o.votes,
            percentage: totalVotes > 0 ? Math.round((o.votes / totalVotes) * 100) : 0,
            isSelected: viewerId ? o.voters.includes(viewerId) : false
        }))
    };
}

// ============================================================================
// Block Builder - WhatsApp Style
// ============================================================================

/**
 * Build a single option row with:
 * - Selection circle (in text)
 * - Option text (in text)
 * - Progress bar (in text)
 * - Vote count (in text)
 * - Minimal click button (accessory)
 */
function buildPollOptionRow(
    option: OptionStats, 
    pollId: string
): any {
    // Selection indicator
    const circle = option.isSelected ? '🔘' : '⭕';
    
    // Progress bar
    const progressBar = generateProgressBar(option.percentage, 16);
    
    // Vote count display
    const voteText = option.votes === 1 ? '1 vote' : `${option.votes} votes`;
    
    // Build the display text - all content here (never replaced by loading)
    // Format:
    // 🔘 Option Text
    // ▓▓▓▓▓▓░░░░░░░░░░ 40% • 2 votes
    const displayText = [
        `${circle}  *${option.text}*`,
        `${progressBar}  ${option.percentage}% • ${voteText}`
    ].join('\n');
    
    return {
        type: 'section',
        blockId: `opt_${pollId}_${option.id}`,
        text: {
            type: 'mrkdwn',
            text: displayText
        },
        accessory: {
            type: 'button',
            text: {
                type: 'plain_text',
                // Minimal button label - just shows selection state
                text: option.isSelected ? '✓' : '○',
                emoji: true
            },
            value: `${pollId}|${option.id}`,
            actionId: `vote_${pollId}_${option.id}`,
            appId: 'poll-app',
            // Primary style for selected options
            ...(option.isSelected && { style: 'primary' })
        }
    };
}

/**
 * Build complete poll message blocks
 */
function buildPollBlocks(poll: Poll, viewerId?: string): any[] {
    const stats = calculateVoteStats(poll, viewerId);
    const blocks: any[] = [];
    
    // Poll question header
    blocks.push({
        type: 'section',
        blockId: `header_${poll.id}`,
        text: {
            type: 'mrkdwn',
            text: `📊  *${poll.question}*`
        }
    });
    
    // Small spacing context
    blocks.push({
        type: 'context',
        blockId: `spacer_${poll.id}`,
        elements: [{
            type: 'mrkdwn',
            text: ' '  // Minimal spacer
        }]
    });
    
    // Option rows
    stats.options.forEach(option => {
        blocks.push(buildPollOptionRow(option, poll.id));
    });
    
    // Footer with poll info
    const choiceType = poll.allowMultiple ? '☑️ Multiple choice' : '○ Single choice';
    const totalText = stats.totalVotes === 1 ? '1 vote' : `${stats.totalVotes} votes`;
    
    blocks.push({
        type: 'context',
        blockId: `footer_${poll.id}`,
        elements: [{
            type: 'mrkdwn',
            text: `${choiceType}  •  ${totalText} total`
        }]
    });
    
    return blocks;
}

// ============================================================================
// Poll Message Updater
// ============================================================================

/**
 * Update the poll message with new blocks and notify all clients
 */
async function updatePollMessage(poll: Poll): Promise<boolean> {
    if (!poll.messageId) {
        console.error('[Poll] No messageId for poll:', poll.id);
        return false;
    }
    
    try {
        // Build new blocks (without viewer context - each client will see their own state)
        const newBlocks = buildPollBlocks(poll);
        
        // Update in database
        const result = await Messages.updateOne(
            { _id: poll.messageId },
            { 
                $set: { 
                    blocks: newBlocks,
                    _updatedAt: new Date()
                } 
            }
        );
        
        if (result.modifiedCount === 0) {
            console.warn('[Poll] Message not modified:', poll.messageId);
        }
        
        // Trigger real-time update to all clients
        await notifyOnMessageChange({ id: poll.messageId });
        
        return true;
    } catch (err) {
        console.error('[Poll] Failed to update message:', err);
        return false;
    }
}

// ============================================================================
// Vote Handler
// ============================================================================

/**
 * Handle vote action - toggle vote on an option
 */
async function handleVoteAction(
    pollId: string, 
    optionId: string, 
    userId: string
): Promise<{ success: boolean; error?: string }> {
    
    const poll = polls.get(pollId);
    if (!poll) {
        return { success: false, error: 'Poll not found or expired' };
    }

    const option = poll.options.find(o => o.id === optionId);
    if (!option) {
        return { success: false, error: 'Invalid option' };
    }

    const wasSelected = option.voters.includes(userId);
    
    if (poll.allowMultiple) {
        // Multiple choice: toggle this option
        if (wasSelected) {
            option.votes = Math.max(0, option.votes - 1);
            option.voters = option.voters.filter(v => v !== userId);
        } else {
            option.votes++;
            option.voters.push(userId);
        }
    } else {
        // Single choice: remove all votes first, then add if different option
        poll.options.forEach(o => {
            const idx = o.voters.indexOf(userId);
            if (idx !== -1) {
                o.votes = Math.max(0, o.votes - 1);
                o.voters.splice(idx, 1);
            }
        });
        
        // Add vote only if clicking a different option
        if (!wasSelected) {
            option.votes++;
            option.voters.push(userId);
        }
    }

    // Update message for all users
    await updatePollMessage(poll);

    return { success: true };
}

// ============================================================================
// Meteor Methods
// ============================================================================

Meteor.methods({
    /**
     * Create a new poll
     */
    async 'poll.create'(data: {
        question: string;
        options: string[];
        roomId?: string;
        allowMultiple?: boolean;
    }) {
        const userId = Meteor.userId();
        if (!userId) {
            throw new Meteor.Error('not-authorized', 'Login required');
        }

        const { roomId, question, options, allowMultiple } = data;
        
        // Validation
        if (!roomId) {
            throw new Meteor.Error('invalid-room', 'Room ID required');
        }
        
        const room = await Rooms.findOneById(roomId, { projection: { _id: 1 } });
        if (!room) {
            throw new Meteor.Error('invalid-room', 'Room not found');
        }

        if (!question?.trim()) {
            throw new Meteor.Error('invalid-question', 'Question required');
        }

        const cleanOptions = (options || []).map(o => o?.trim()).filter(Boolean);
        if (cleanOptions.length < 2) {
            throw new Meteor.Error('invalid-options', 'At least 2 options required');
        }

        // Create poll
        const pollId = `p${Date.now().toString(36)}${Math.random().toString(36).substr(2, 4)}`;
        
        const poll: Poll = {
            id: pollId,
            question: question.trim(),
            options: cleanOptions.map((text, i) => ({
                id: String.fromCharCode(65 + i),
                text,
                votes: 0,
                voters: []
            })),
            creator: userId,
            roomId,
            allowMultiple: allowMultiple || false,
            createdAt: new Date()
        };

        polls.set(pollId, poll);

        // Send poll message
        let sentMessage;
        try {
            sentMessage = await executeSendMessage(userId, {
                rid: roomId,
                msg: '',
                blocks: buildPollBlocks(poll, userId),
            });
        } catch (err: any) {
            polls.delete(pollId);
            throw new Meteor.Error('create-failed', err?.reason || 'Failed to create poll');
        }

        if (sentMessage?._id) {
            poll.messageId = sentMessage._id;
        }

        console.log('[Poll] Created:', pollId);
        return { success: true, pollId };
    },

    /**
     * Vote on a poll option
     */
    async 'poll.vote'(pollId: string, optionId: string) {
        const userId = Meteor.userId();
        if (!userId) {
            throw new Meteor.Error('not-authorized', 'Login required');
        }

        if (!pollId || !optionId) {
            throw new Meteor.Error('invalid-params', 'Poll ID and option required');
        }

        const result = await handleVoteAction(pollId, optionId.toUpperCase(), userId);
        
        if (!result.success) {
            throw new Meteor.Error('vote-failed', result.error);
        }

        return result;
    },

    /**
     * Get poll data
     */
    'poll.get'(pollId: string) {
        const poll = polls.get(pollId);
        if (!poll) return null;

        const userId = Meteor.userId();
        return calculateVoteStats(poll, userId || undefined);
    },

    /**
     * Handle UIKit block action
     */
    async 'poll.blockAction'(data: { actionId: string; value: string }) {
        const userId = Meteor.userId();
        if (!userId) {
            return { success: false, error: 'Not authorized' };
        }

        // Parse value: pollId|optionId
        const [pollId, optionId] = (data.value || '').split('|');
        if (!pollId || !optionId) {
            return { success: false, error: 'Invalid action' };
        }

        return await handleVoteAction(pollId, optionId, userId);
    }
});

// ============================================================================
// Slash Commands
// ============================================================================

slashCommands.add({
    command: 'poll-vote',
    callback: async function({ params, userId }) {
        if (!params?.trim()) {
            throw new Meteor.Error('usage', 'Usage: /poll-vote <poll_id> <option>');
        }
        
        const [pollId, optionId] = params.trim().split(/\s+/);
        if (!pollId || !optionId) {
            throw new Meteor.Error('usage', 'Usage: /poll-vote <poll_id> <option>');
        }

        const result = await handleVoteAction(pollId, optionId.toUpperCase(), userId);
        if (!result.success) {
            throw new Meteor.Error('vote-failed', result.error);
        }
        
        return result;
    },
    options: {
        description: 'Vote in a poll',
        params: '<poll_id> <option>'
    }
});

slashCommands.add({
    command: 'poll',
    callback: async function() {
        throw new Meteor.Error('info', 'Use the 📊 button to create a poll');
    },
    options: {
        description: 'Create a poll',
        params: ''
    }
});
