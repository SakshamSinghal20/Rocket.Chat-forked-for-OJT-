// Poll System - Rocket.Chat Native Theme with Admin Controls
import { Meteor } from 'meteor/meteor';
import { Rooms, Messages, Users } from '@rocket.chat/models';
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
    createdAt: Date;
    totalVoters: Set<string>;
}

const polls = new Map<string, Poll>();

// ============================================================================
// Helpers
// ============================================================================

function generateProgressBar(percentage: number): string {
    const width = 15;
    const filled = Math.round((percentage / 100) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function calculateStats(poll: Poll, viewerId?: string) {
    const totalVotes = poll.options.reduce((sum, o) => sum + o.votes, 0);
    return {
        totalVotes,
        totalVoters: poll.totalVoters.size,
        options: poll.options.map(o => ({
            ...o,
            percentage: totalVotes > 0 ? Math.round((o.votes / totalVotes) * 100) : 0,
            isSelected: viewerId ? o.voters.includes(viewerId) : false
        }))
    };
}

async function isAdmin(userId: string): Promise<boolean> {
    try {
        return await hasPermissionAsync(userId, 'admin');
    } catch {
        return false;
    }
}

// ============================================================================
// Pie Chart Results Message
// ============================================================================

function generateResultsMessage(poll: Poll): string {
    const stats = calculateStats(poll);
    
    let msg = `📊 *POLL RESULTS*\n\n`;
    msg += `*${poll.question}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    // Find winner
    const maxVotes = Math.max(...stats.options.map(o => o.votes));
    
    stats.options.forEach((opt, i) => {
        const emoji = ['🔴', '🔵', '🟢', '🟡', '🟣'][i % 5];
        const winner = opt.votes === maxVotes && opt.votes > 0 ? ' 🏆' : '';
        const bar = generateProgressBar(opt.percentage);
        
        msg += `${emoji} *${opt.text}*${winner}\n`;
        msg += `${bar} ${opt.percentage}% (${opt.votes})\n\n`;
    });
    
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `👥 ${stats.totalVoters} voter${stats.totalVoters !== 1 ? 's' : ''} • `;
    msg += `${stats.totalVotes} vote${stats.totalVotes !== 1 ? 's' : ''}\n`;
    msg += `${poll.isAnonymous ? '🔒 Anonymous' : '👁 Public'} • `;
    msg += `${poll.allowMultiple ? 'Multiple choice' : 'Single choice'}`;
    
    return msg;
}

// ============================================================================
// Block Builder - Native Rocket.Chat Style
// ============================================================================

function buildPollBlocks(poll: Poll, viewerId?: string): any[] {
    const stats = calculateStats(poll, viewerId);
    const blocks: any[] = [];
    
    // Header
    const statusText = poll.isClosed ? ' [CLOSED 🔒]' : '';
    blocks.push({
        type: 'section',
        text: {
            type: 'mrkdwn',
            text: `📊 *${poll.question}*${statusText}`
        }
    });
    
    // Settings line
    const settings = [];
    if (poll.isAnonymous) settings.push('🔒 Anonymous');
    settings.push(poll.allowMultiple ? '☑️ Multiple choice' : '⭕ Single choice');
    
    blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: settings.join(' • ') }]
    });
    
    // Options
    stats.options.forEach((opt, i) => {
        const emoji = ['🔴', '🔵', '🟢', '🟡', '🟣'][i % 5];
        const check = opt.isSelected ? '✅' : '⬜';
        const bar = generateProgressBar(opt.percentage);
        
        const displayText = poll.isClosed
            ? `${emoji} *${opt.text}*\n${bar} ${opt.percentage}% • ${opt.votes} vote${opt.votes !== 1 ? 's' : ''}`
            : `${check} *${opt.text}*\n${bar} ${opt.percentage}% • ${opt.votes} vote${opt.votes !== 1 ? 's' : ''}`;
        
        const block: any = {
            type: 'section',
            blockId: `opt_${poll.id}_${opt.id}`,
            text: { type: 'mrkdwn', text: displayText }
        };
        
        // Vote button only for open polls
        if (!poll.isClosed) {
            block.accessory = {
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: opt.isSelected ? '✓ Voted' : 'Vote',
                    emoji: true
                },
                value: `${poll.id}|${opt.id}`,
                actionId: `vote_${poll.id}_${opt.id}`,
                appId: 'poll-app',
                ...(opt.isSelected && { style: 'primary' })
            };
        }
        
        blocks.push(block);
    });
    
    // Footer stats
    blocks.push({
        type: 'context',
        elements: [{
            type: 'mrkdwn',
            text: `📈 ${stats.totalVotes} vote${stats.totalVotes !== 1 ? 's' : ''} • 👥 ${stats.totalVoters} voter${stats.totalVoters !== 1 ? 's' : ''} • by ${poll.creatorName || 'Unknown'}`
        }]
    });
    
    // CLOSE BUTTON - Always shown for open polls (permission checked on click)
    if (!poll.isClosed) {
        blocks.push({
            type: 'actions',
            blockId: `admin_${poll.id}`,
            elements: [{
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: '🔒 Close Poll (Admin)',
                    emoji: true
                },
                value: poll.id,
                actionId: `close_${poll.id}`,
                appId: 'poll-app',
                style: 'danger'
            }]
        });
    }
    
    // Closed info
    if (poll.isClosed && poll.closedAt) {
        blocks.push({
            type: 'context',
            elements: [{
                type: 'mrkdwn',
                text: `🔒 _Closed on ${poll.closedAt.toLocaleString()}_`
            }]
        });
    }
    
    return blocks;
}

// ============================================================================
// Update Poll Message
// ============================================================================

async function updatePollMessage(poll: Poll): Promise<boolean> {
    if (!poll.messageId) return false;
    
    try {
        const blocks = buildPollBlocks(poll);
        
        await Messages.updateOne(
            { _id: poll.messageId },
            { $set: { blocks, _updatedAt: new Date() } }
        );
        
        await notifyOnMessageChange({ id: poll.messageId });
        return true;
    } catch (err) {
        console.error('[Poll] Update failed:', err);
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
    }) {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        const { roomId, question, options, allowMultiple, isAnonymous } = data;
        
        if (!roomId) throw new Meteor.Error('invalid-room');
        const room = await Rooms.findOneById(roomId, { projection: { _id: 1 } });
        if (!room) throw new Meteor.Error('invalid-room');
        if (!question?.trim()) throw new Meteor.Error('invalid-question');
        
        const cleanOptions = (options || []).map(o => o?.trim()).filter(Boolean);
        if (cleanOptions.length < 2) throw new Meteor.Error('invalid-options');

        const creator = await Users.findOneById(userId, { projection: { name: 1, username: 1 } });

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
            creatorName: creator?.name || creator?.username || 'Unknown',
            roomId,
            allowMultiple: allowMultiple || false,
            isAnonymous: isAnonymous || false,
            isClosed: false,
            createdAt: new Date(),
            totalVoters: new Set()
        };

        polls.set(pollId, poll);

        try {
            const sent = await executeSendMessage(userId, {
                rid: roomId,
                msg: '',
                blocks: buildPollBlocks(poll, userId),
            });
            
            if (sent?._id) poll.messageId = sent._id;
            return { success: true, pollId };
        } catch (err: any) {
            polls.delete(pollId);
            throw new Meteor.Error('create-failed', err?.reason || 'Failed');
        }
    },

    async 'poll.vote'(pollId: string, optionId: string) {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');
        
        const poll = polls.get(pollId);
        if (!poll) throw new Meteor.Error('not-found', 'Poll not found');
        if (poll.isClosed) throw new Meteor.Error('closed', 'Poll is closed');

        const option = poll.options.find(o => o.id === optionId.toUpperCase());
        if (!option) throw new Meteor.Error('invalid', 'Invalid option');

        const wasSelected = option.voters.includes(userId);
        poll.totalVoters.add(userId);
        
        if (poll.allowMultiple) {
            if (wasSelected) {
                option.votes = Math.max(0, option.votes - 1);
                option.voters = option.voters.filter(v => v !== userId);
            } else {
                option.votes++;
                option.voters.push(userId);
            }
        } else {
            poll.options.forEach(o => {
                const idx = o.voters.indexOf(userId);
                if (idx !== -1) {
                    o.votes = Math.max(0, o.votes - 1);
                    o.voters.splice(idx, 1);
                }
            });
            
            if (!wasSelected) {
                option.votes++;
                option.voters.push(userId);
            }
        }

        // Rebuild blocks
        const blocks = buildPollBlocks(poll, userId);
        
        if (poll.messageId) {
            await Messages.updateOne(
                { _id: poll.messageId },
                { $set: { blocks, _updatedAt: new Date() } }
            );
            await notifyOnMessageChange({ id: poll.messageId });
        }

        return { success: true };
    },

    async 'poll.close'(pollId: string) {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        // ADMIN CHECK
        const userIsAdmin = await isAdmin(userId);
        if (!userIsAdmin) {
            throw new Meteor.Error('not-authorized', 'Only admins can close polls');
        }

        const poll = polls.get(pollId);
        if (!poll) throw new Meteor.Error('not-found', 'Poll not found');
        if (poll.isClosed) throw new Meteor.Error('already-closed', 'Poll already closed');

        // Close the poll
        poll.isClosed = true;
        poll.closedAt = new Date();
        poll.closedBy = userId;

        // Update poll message
        const blocks = buildPollBlocks(poll);
        if (poll.messageId) {
            await Messages.updateOne(
                { _id: poll.messageId },
                { $set: { blocks, _updatedAt: new Date() } }
            );
            await notifyOnMessageChange({ id: poll.messageId });
        }

        // Publish results as new message
        const resultsMsg = generateResultsMessage(poll);
        await executeSendMessage(userId, {
            rid: poll.roomId,
            msg: resultsMsg,
        });

        return { success: true };
    },

    async 'poll.checkAdmin'() {
        const userId = Meteor.userId();
        if (!userId) return false;
        return await isAdmin(userId);
    },

    async 'poll.refreshBlocks'(pollId: string) {
        const userId = Meteor.userId();
        if (!userId) return { success: false };

        const poll = polls.get(pollId);
        if (!poll || !poll.messageId) return { success: false };

        const blocks = buildPollBlocks(poll, userId);
        
        await Messages.updateOne(
            { _id: poll.messageId },
            { $set: { blocks, _updatedAt: new Date() } }
        );
        await notifyOnMessageChange({ id: poll.messageId });

        return { success: true };
    }
});

// No slash commands - poll is accessed via the toolbar button
