// Poll System - Enhanced with Admin Controls, Pie Chart Results, Beautiful UI
import { Meteor } from 'meteor/meteor';
import { Rooms, Messages, Users } from '@rocket.chat/models';
import { slashCommands } from '../../utils/server/slashCommand';
import { executeSendMessage } from '../../lib/server/methods/sendMessage';
import { notifyOnMessageChange } from '../../lib/server/lib/notifyListener';
import { hasPermissionAsync } from '../../authorization/server/functions/hasPermission';

// ============================================================================
// Types
// ============================================================================

interface PollOption {
    id: string;
    text: string;
    votes: number;
    voters: string[];
    voterNames?: string[];
    color: string;  // For pie chart
}

interface Poll {
    id: string;
    question: string;
    options: PollOption[];
    creator: string;
    creatorName?: string;
    roomId: string;
    messageId?: string;
    allowMultiple: boolean;
    isAnonymous: boolean;
    isClosed: boolean;
    closedBy?: string;
    closedAt?: Date;
    scheduledFor?: Date;
    createdAt: Date;
    totalVoters: Set<string>;
}

interface OptionStats {
    id: string;
    text: string;
    votes: number;
    percentage: number;
    isSelected: boolean;
    color: string;
}

const polls = new Map<string, Poll>();
const scheduledPolls = new Map<string, NodeJS.Timeout>();

// Vibrant colors for pie chart
const CHART_COLORS = [
    '#FF6B6B', // Coral Red
    '#4ECDC4', // Teal
    '#45B7D1', // Sky Blue
    '#96CEB4', // Sage Green
    '#FFEAA7', // Soft Yellow
    '#DDA0DD', // Plum
    '#98D8C8', // Mint
    '#F7DC6F', // Gold
    '#BB8FCE', // Lavender
    '#85C1E9', // Light Blue
];

// ============================================================================
// Visual Generators
// ============================================================================

function generateProgressBar(percentage: number, width: number = 20): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

function generatePieChartMessage(poll: Poll): string {
    const stats = calculateVoteStats(poll);
    const total = stats.totalVotes;
    
    if (total === 0) {
        return '📊 *Poll Results*\n\n_No votes were cast_';
    }
    
    // Header
    let message = `📊 *POLL RESULTS*\n\n`;
    message += `❓ *${poll.question}*\n\n`;
    
    // Pie chart visualization using colored circles
    message += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    
    // Find winner(s)
    const maxVotes = Math.max(...stats.options.map(o => o.votes));
    const winners = stats.options.filter(o => o.votes === maxVotes && o.votes > 0);
    
    // Results with visual bars
    stats.options.forEach((opt, i) => {
        const isWinner = opt.votes === maxVotes && opt.votes > 0;
        const trophy = isWinner ? ' 🏆' : '';
        const bar = generateProgressBar(opt.percentage, 15);
        const emoji = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠', '⚫', '⚪', '🟤', '🔷'][i % 10];
        
        message += `\n${emoji} *${opt.text}*${trophy}\n`;
        message += `${bar} ${opt.percentage}% (${opt.votes} vote${opt.votes !== 1 ? 's' : ''})\n`;
    });
    
    message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    
    // Winner announcement
    if (winners.length === 1) {
        message += `\n🎉 *Winner: ${winners[0].text}*\n`;
    } else if (winners.length > 1) {
        message += `\n🎉 *Tie between: ${winners.map(w => w.text).join(' & ')}*\n`;
    }
    
    // Stats
    message += `\n📈 *Statistics:*\n`;
    message += `• Total votes: ${stats.totalVotes}\n`;
    message += `• Total voters: ${stats.totalVoters}\n`;
    message += `• Poll type: ${poll.allowMultiple ? 'Multiple choice' : 'Single choice'}\n`;
    message += `• Anonymous: ${poll.isAnonymous ? 'Yes 🔒' : 'No'}\n`;
    
    return message;
}

// ============================================================================
// Vote Statistics
// ============================================================================

function calculateVoteStats(poll: Poll, viewerId?: string): { 
    totalVotes: number;
    totalVoters: number;
    options: OptionStats[];
} {
    const totalVotes = poll.options.reduce((sum, o) => sum + o.votes, 0);
    const totalVoters = poll.totalVoters.size;
    
    return {
        totalVotes,
        totalVoters,
        options: poll.options.map(o => ({
            id: o.id,
            text: o.text,
            votes: o.votes,
            percentage: totalVotes > 0 ? Math.round((o.votes / totalVotes) * 100) : 0,
            isSelected: viewerId ? o.voters.includes(viewerId) : false,
            color: o.color
        }))
    };
}

// ============================================================================
// Block Builder - Enhanced Beautiful UI
// ============================================================================

function buildPollOptionRow(option: OptionStats, pollId: string, isClosed: boolean, index: number): any {
    const emoji = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠', '⚫', '⚪', '🟤', '🔷'][index % 10];
    const circle = option.isSelected ? '✅' : '⬜';
    const progressBar = generateProgressBar(option.percentage, 12);
    const voteText = option.votes === 1 ? '1 vote' : `${option.votes} votes`;
    
    // Beautiful formatted option
    const displayText = isClosed
        ? `${emoji} *${option.text}*\n└ ${progressBar} *${option.percentage}%* • ${voteText}`
        : `${circle} *${option.text}*\n└ ${progressBar} *${option.percentage}%* • ${voteText}`;
    
    const block: any = {
        type: 'section',
        blockId: `opt_${pollId}_${option.id}`,
        text: {
            type: 'mrkdwn',
            text: displayText
        }
    };
    
    // Vote button only for open polls
    if (!isClosed) {
        block.accessory = {
            type: 'button',
            text: {
                type: 'plain_text',
                text: option.isSelected ? '✓ Voted' : 'Vote',
                emoji: true
            },
            value: `${pollId}|${option.id}`,
            actionId: `vote_${pollId}_${option.id}`,
            appId: 'poll-app',
            ...(option.isSelected && { style: 'primary' })
        };
    }
    
    return block;
}

function buildPollBlocks(poll: Poll, viewerId?: string, isAdmin: boolean = false): any[] {
    const stats = calculateVoteStats(poll, viewerId);
    const blocks: any[] = [];
    
    // Beautiful header with gradient effect simulation
    const statusIcon = poll.isClosed ? '🔒' : '📊';
    const statusText = poll.isClosed ? ' _[CLOSED]_' : '';
    
    blocks.push({
        type: 'header',
        blockId: `header_${poll.id}`,
        text: {
            type: 'plain_text',
            text: `${statusIcon} Poll`,
            emoji: true
        }
    });
    
    // Question with nice styling
    blocks.push({
        type: 'section',
        blockId: `question_${poll.id}`,
        text: {
            type: 'mrkdwn',
            text: `*${poll.question}*${statusText}`
        }
    });
    
    // Anonymous/Settings indicator
    const settings: string[] = [];
    if (poll.isAnonymous) settings.push('🔒 Anonymous');
    if (poll.allowMultiple) settings.push('☑️ Multiple choice');
    else settings.push('⭕ Single choice');
    
    blocks.push({
        type: 'context',
        blockId: `settings_${poll.id}`,
        elements: [{
            type: 'mrkdwn',
            text: settings.join('  •  ')
        }]
    });
    
    blocks.push({ type: 'divider' });
    
    // Options with beautiful formatting
    stats.options.forEach((option, index) => {
        blocks.push(buildPollOptionRow(option, poll.id, poll.isClosed, index));
    });
    
    blocks.push({ type: 'divider' });
    
    // Stats footer
    const voterText = stats.totalVoters === 1 ? '1 person voted' : `${stats.totalVoters} people voted`;
    const totalVoteText = stats.totalVotes === 1 ? '1 vote' : `${stats.totalVotes} votes`;
    
    blocks.push({
        type: 'context',
        blockId: `footer_${poll.id}`,
        elements: [{
            type: 'mrkdwn',
            text: `📈 ${totalVoteText} • 👥 ${voterText} • Created by *${poll.creatorName || 'Unknown'}*`
        }]
    });
    
    // Admin controls - ONLY for admins
    if (isAdmin) {
        if (!poll.isClosed) {
            // Show Close button for open polls
            blocks.push({
                type: 'actions',
                blockId: `admin_${poll.id}`,
                elements: [{
                    type: 'button',
                    text: { type: 'plain_text', text: '🔒 Close Poll & Publish Results', emoji: true },
                    value: `close_${poll.id}`,
                    actionId: `close_${poll.id}`,
                    appId: 'poll-app',
                    style: 'danger',
                    confirm: {
                        title: { type: 'plain_text', text: 'Close Poll?' },
                        text: { type: 'mrkdwn', text: 'This will close the poll and publish the final results as a pie chart. This cannot be undone.' },
                        confirm: { type: 'plain_text', text: 'Close & Publish' },
                        deny: { type: 'plain_text', text: 'Cancel' }
                    }
                }]
            });
        }
    }
    
    // Closed poll info
    if (poll.isClosed && poll.closedAt) {
        blocks.push({
            type: 'context',
            blockId: `closed_${poll.id}`,
            elements: [{
                type: 'mrkdwn',
                text: `🔒 _Poll closed on ${poll.closedAt.toLocaleDateString()} at ${poll.closedAt.toLocaleTimeString()}_`
            }]
        });
    }
    
    return blocks;
}

// ============================================================================
// Poll Update
// ============================================================================

async function updatePollMessage(poll: Poll): Promise<boolean> {
    if (!poll.messageId) return false;
    
    try {
        // We need to check admin status for each viewer, but for broadcast we use generic view
        const newBlocks = buildPollBlocks(poll, undefined, false);
        
        await Messages.updateOne(
            { _id: poll.messageId },
            { $set: { blocks: newBlocks, _updatedAt: new Date() } }
        );
        
        await notifyOnMessageChange({ id: poll.messageId });
        return true;
    } catch (err) {
        console.error('[Poll] Update failed:', err);
        return false;
    }
}

async function publishPollResults(poll: Poll, userId: string): Promise<void> {
    try {
        // Send pie chart results as a new message
        const resultsMessage = generatePieChartMessage(poll);
        
        await executeSendMessage(userId, {
            rid: poll.roomId,
            msg: resultsMessage,
        });
        
        console.log('[Poll] Results published for:', poll.id);
    } catch (err) {
        console.error('[Poll] Failed to publish results:', err);
    }
}

// ============================================================================
// Vote Handler
// ============================================================================

async function handleVoteAction(pollId: string, optionId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    const poll = polls.get(pollId);
    if (!poll) return { success: false, error: 'Poll not found' };
    if (poll.isClosed) return { success: false, error: 'Poll is closed' };

    const option = poll.options.find(o => o.id === optionId);
    if (!option) return { success: false, error: 'Invalid option' };

    let userName = 'User';
    if (!poll.isAnonymous) {
        const user = await Users.findOneById(userId, { projection: { name: 1, username: 1 } });
        userName = user?.name || user?.username || 'User';
    }

    const wasSelected = option.voters.includes(userId);
    poll.totalVoters.add(userId);
    
    if (poll.allowMultiple) {
        if (wasSelected) {
            option.votes = Math.max(0, option.votes - 1);
            option.voters = option.voters.filter(v => v !== userId);
            if (!poll.isAnonymous && option.voterNames) {
                option.voterNames = option.voterNames.filter(n => n !== userName);
            }
        } else {
            option.votes++;
            option.voters.push(userId);
            if (!poll.isAnonymous) {
                option.voterNames = option.voterNames || [];
                option.voterNames.push(userName);
            }
        }
    } else {
        poll.options.forEach(o => {
            const idx = o.voters.indexOf(userId);
            if (idx !== -1) {
                o.votes = Math.max(0, o.votes - 1);
                o.voters.splice(idx, 1);
                if (!poll.isAnonymous && o.voterNames) {
                    const nameIdx = o.voterNames.indexOf(userName);
                    if (nameIdx !== -1) o.voterNames.splice(nameIdx, 1);
                }
            }
        });
        
        if (!wasSelected) {
            option.votes++;
            option.voters.push(userId);
            if (!poll.isAnonymous) {
                option.voterNames = option.voterNames || [];
                option.voterNames.push(userName);
            }
        }
    }

    await updatePollMessage(poll);
    return { success: true };
}

// ============================================================================
// Admin Check Helper
// ============================================================================

async function isUserAdmin(userId: string): Promise<boolean> {
    try {
        return await hasPermissionAsync(userId, 'admin');
    } catch {
        return false;
    }
}

// ============================================================================
// Meteor Methods
// ============================================================================

Meteor.methods({
    async 'poll.create'(data: {
        question: string;
        options: string[];
        roomId?: string;
        allowMultiple?: boolean;
        isAnonymous?: boolean;
        scheduledFor?: Date;
    }) {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        const { roomId, question, options, allowMultiple, isAnonymous, scheduledFor } = data;
        
        if (!roomId) throw new Meteor.Error('invalid-room', 'Room ID required');
        
        const room = await Rooms.findOneById(roomId, { projection: { _id: 1 } });
        if (!room) throw new Meteor.Error('invalid-room', 'Room not found');

        if (!question?.trim()) throw new Meteor.Error('invalid-question', 'Question required');

        const cleanOptions = (options || []).map(o => o?.trim()).filter(Boolean);
        if (cleanOptions.length < 2) throw new Meteor.Error('invalid-options', 'Min 2 options required');

        const creator = await Users.findOneById(userId, { projection: { name: 1, username: 1 } });
        const creatorName = creator?.name || creator?.username || 'Unknown';
        const userIsAdmin = await isUserAdmin(userId);

        const pollId = `p${Date.now().toString(36)}${Math.random().toString(36).substr(2, 4)}`;
        
        const poll: Poll = {
            id: pollId,
            question: question.trim(),
            options: cleanOptions.map((text, i) => ({
                id: String.fromCharCode(65 + i),
                text,
                votes: 0,
                voters: [],
                voterNames: [],
                color: CHART_COLORS[i % CHART_COLORS.length]
            })),
            creator: userId,
            creatorName,
            roomId,
            allowMultiple: allowMultiple || false,
            isAnonymous: isAnonymous || false,
            isClosed: false,
            createdAt: new Date(),
            totalVoters: new Set()
        };

        if (scheduledFor && scheduledFor > new Date()) {
            poll.scheduledFor = scheduledFor;
            polls.set(pollId, poll);
            
            const delay = scheduledFor.getTime() - Date.now();
            const timeout = setTimeout(async () => {
                const p = polls.get(pollId);
                if (p) {
                    const sent = await executeSendMessage(p.creator, {
                        rid: p.roomId,
                        msg: '',
                        blocks: buildPollBlocks(p, p.creator, userIsAdmin),
                    });
                    if (sent?._id) p.messageId = sent._id;
                }
                scheduledPolls.delete(pollId);
            }, delay);
            scheduledPolls.set(pollId, timeout);
            
            return { success: true, pollId, scheduled: true, scheduledFor };
        }

        polls.set(pollId, poll);

        let sentMessage;
        try {
            sentMessage = await executeSendMessage(userId, {
                rid: roomId,
                msg: '',
                blocks: buildPollBlocks(poll, userId, userIsAdmin),
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

    async 'poll.vote'(pollId: string, optionId: string) {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        const result = await handleVoteAction(pollId, optionId.toUpperCase(), userId);
        if (!result.success) throw new Meteor.Error('vote-failed', result.error);
        return result;
    },

    async 'poll.close'(pollId: string) {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        const poll = polls.get(pollId);
        if (!poll) throw new Meteor.Error('not-found', 'Poll not found');

        // ONLY admin can close
        const userIsAdmin = await isUserAdmin(userId);
        if (!userIsAdmin) {
            throw new Meteor.Error('not-authorized', 'Only administrators can close polls');
        }

        poll.isClosed = true;
        poll.closedAt = new Date();
        poll.closedBy = userId;

        // Update the poll message
        await updatePollMessage(poll);
        
        // Publish pie chart results as new message
        await publishPollResults(poll, userId);
        
        console.log('[Poll] Closed and results published:', pollId);
        return { success: true };
    },

    async 'poll.checkAdmin'() {
        const userId = Meteor.userId();
        if (!userId) return false;
        return await isUserAdmin(userId);
    },

    'poll.get'(pollId: string) {
        const poll = polls.get(pollId);
        if (!poll) return null;

        const userId = Meteor.userId();
        const stats = calculateVoteStats(poll, userId || undefined);
        
        return {
            ...stats,
            question: poll.question,
            isAnonymous: poll.isAnonymous,
            allowMultiple: poll.allowMultiple,
            isClosed: poll.isClosed,
            createdAt: poll.createdAt
        };
    },

    async 'poll.blockAction'(data: { actionId: string; value: string }) {
        const userId = Meteor.userId();
        if (!userId) return { success: false };

        const { actionId, value } = data;

        if (actionId.startsWith('vote_')) {
            const [pollId, optionId] = value.split('|');
            return await handleVoteAction(pollId, optionId, userId);
        }

        if (actionId.startsWith('close_')) {
            const pollId = value.replace('close_', '');
            try {
                await Meteor.callAsync('poll.close', pollId);
                return { success: true, action: 'closed' };
            } catch (e: any) {
                return { success: false, error: e.reason };
            }
        }

        return { success: false };
    }
});

// ============================================================================
// Slash Commands
// ============================================================================

slashCommands.add({
    command: 'poll-vote',
    callback: async function({ params, userId }) {
        if (!params?.trim()) throw new Meteor.Error('usage', '/poll-vote <poll_id> <option>');
        const [pollId, optionId] = params.trim().split(/\s+/);
        if (!pollId || !optionId) throw new Meteor.Error('usage', '/poll-vote <poll_id> <option>');
        
        const result = await handleVoteAction(pollId, optionId.toUpperCase(), userId);
        if (!result.success) throw new Meteor.Error('vote-failed', result.error);
        return result;
    },
    options: { description: 'Vote in a poll', params: '<poll_id> <option>' }
});

slashCommands.add({
    command: 'poll-close',
    callback: async function({ params, userId }) {
        if (!params?.trim()) throw new Meteor.Error('usage', '/poll-close <poll_id>');
        
        const userIsAdmin = await isUserAdmin(userId);
        if (!userIsAdmin) {
            throw new Meteor.Error('not-authorized', 'Only administrators can close polls');
        }
        
        await Meteor.callAsync('poll.close', params.trim());
        return { success: true };
    },
    options: { description: 'Close a poll (Admin only)', params: '<poll_id>' }
});

slashCommands.add({
    command: 'poll',
    callback: async function() {
        throw new Meteor.Error('info', 'Use the 📊 button to create a poll');
    },
    options: { description: 'Create a poll', params: '' }
});
