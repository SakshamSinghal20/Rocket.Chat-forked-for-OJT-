// Poll System - Complete Implementation
import { Meteor } from 'meteor/meteor';
import { Rooms, Messages, Users } from '@rocket.chat/models';
import { executeSendMessage } from '../../lib/server/methods/sendMessage';
import { notifyOnMessageChange } from '../../lib/server/lib/notifyListener';
import { hasPermissionAsync } from '../../authorization/server/functions/hasPermission';

// Types
interface PollOption {
    id: string;
    text: string;
    votes: number;
    voters: string[]; // userIds
    voterNames: string[]; // display names (for public polls)
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
    scheduledAt?: Date;
    totalVoters: Set<string>;
}

const polls = new Map<string, Poll>();
const scheduledTimers = new Map<string, NodeJS.Timeout>();

// ============================================================================
// Helpers
// ============================================================================

function generateProgressBar(percentage: number): string {
    const width = 12;
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return '▓'.repeat(filled) + '░'.repeat(empty);
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

async function canClosePoll(userId: string, poll: Poll): Promise<boolean> {
    // Poll creator can always close
    if (poll.creator === userId) return true;
    
    // Check admin permission
    try {
        const isAdmin = await hasPermissionAsync(userId, 'admin');
        if (isAdmin) return true;
        
        // Check if user is room owner/moderator
        const room = await Rooms.findOneById(poll.roomId, { projection: { u: 1 } });
        if (room?.u?._id === userId) return true;
    } catch {
        // Ignore permission check errors
    }
    
    return false;
}

async function getUserDisplayName(userId: string): Promise<string> {
    try {
        const user = await Users.findOneById(userId, { projection: { name: 1, username: 1 } });
        return user?.name || user?.username || 'User';
    } catch {
        return 'User';
    }
}

// ============================================================================
// Build Poll Blocks - WhatsApp Style
// ============================================================================

function buildPollBlocks(poll: Poll, viewerId?: string): any[] {
    const stats = calculateStats(poll, viewerId);
    const blocks: any[] = [];
    const emojis = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'];
    
    // Header with status
    const status = poll.isClosed ? ' 🔒 CLOSED' : '';
    blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '📊 *' + poll.question + '*' + status }
    });
    
    // Poll settings info
    const info = [
        poll.isAnonymous ? '🔒 Anonymous' : '👁 Public',
        poll.allowMultiple ? '☑️ Multiple choice' : '⭕ Single choice'
    ];
    blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: info.join(' • ') + ' • ID: `' + poll.id + '`' }]
    });
    
    // Options
    stats.options.forEach((opt, i) => {
        const emoji = emojis[i % emojis.length];
        const bar = generateProgressBar(opt.percentage);
        const circle = opt.isSelected ? '🔘' : '⭕';
        const count = opt.votes;
        
        // Format: Circle OptionText | Progress Bar | Count
        let optionLine = circle + ' *' + opt.text + '*';
        optionLine += '\n    ' + bar + ' ' + opt.percentage + '% • ' + count + ' vote' + (count !== 1 ? 's' : '');
        
        // For public polls, show voters (if not anonymous and has votes)
        if (!poll.isAnonymous && opt.votes > 0 && opt.voterNames.length > 0) {
            const voterList = opt.voterNames.slice(0, 3).join(', ');
            const more = opt.voterNames.length > 3 ? ' +' + (opt.voterNames.length - 3) + ' more' : '';
            optionLine += '\n    _Voters: ' + voterList + more + '_';
        }
        
        const block: any = {
            type: 'section',
            text: { type: 'mrkdwn', text: optionLine }
        };
        
        // Add vote button only if poll is open
        if (!poll.isClosed) {
            block.accessory = {
                type: 'button',
                text: { type: 'plain_text', text: opt.isSelected ? '✓' : emoji, emoji: true },
                value: 'pollvote_' + poll.id + '_' + opt.id,
                actionId: 'pollvote_' + poll.id + '_' + opt.id
            };
        }
        
        blocks.push(block);
    });
    
    // Divider
    blocks.push({ type: 'divider' });
    
    // Stats footer
    blocks.push({
        type: 'context',
        elements: [{
            type: 'mrkdwn',
            text: '📈 ' + stats.totalVotes + ' vote' + (stats.totalVotes !== 1 ? 's' : '') + 
                  ' • 👥 ' + stats.totalVoters + ' voter' + (stats.totalVoters !== 1 ? 's' : '') +
                  ' • Created by ' + (poll.creatorName || 'Unknown')
        }]
    });
    
    // Action buttons
    if (!poll.isClosed) {
        blocks.push({
            type: 'actions',
            elements: [{
                type: 'button',
                text: { type: 'plain_text', text: '🔒 Close Poll', emoji: true },
                value: 'pollclose_' + poll.id,
                actionId: 'pollclose_' + poll.id,
                style: 'danger'
            }]
        });
    } else {
        // Show export button for closed polls
        blocks.push({
            type: 'actions',
            elements: [{
                type: 'button',
                text: { type: 'plain_text', text: '📊 Export Results', emoji: true },
                value: 'pollexport_' + poll.id,
                actionId: 'pollexport_' + poll.id
            }]
        });
        
        // Closed timestamp
        if (poll.closedAt) {
            blocks.push({
                type: 'context',
                elements: [{ type: 'mrkdwn', text: '🔒 _Closed on ' + poll.closedAt.toLocaleString() + '_' }]
            });
        }
    }
    
    return blocks;
}

// ============================================================================
// Generate Pie Chart Results
// ============================================================================

function generatePieChart(poll: Poll): string {
    const stats = calculateStats(poll);
    const emojis = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'];
    const maxVotes = Math.max(...stats.options.map(o => o.votes));
    
    let chart = '📊 **POLL RESULTS - PIE CHART**\n\n';
    chart += '**' + poll.question + '**\n';
    chart += '━'.repeat(25) + '\n\n';
    
    stats.options.forEach((opt, i) => {
        const emoji = emojis[i % emojis.length];
        const bar = generateProgressBar(opt.percentage);
        const winner = (opt.votes === maxVotes && opt.votes > 0) ? ' 🏆' : '';
        
        chart += emoji + ' **' + opt.text + '**' + winner + '\n';
        chart += '   ' + bar + ' ' + opt.percentage + '% (' + opt.votes + ' votes)\n';
        
        // Show voters for public polls
        if (!poll.isAnonymous && opt.voterNames.length > 0) {
            chart += '   _Voters: ' + opt.voterNames.join(', ') + '_\n';
        }
        chart += '\n';
    });
    
    chart += '━'.repeat(25) + '\n';
    chart += '👥 **Total Voters:** ' + stats.totalVoters + '\n';
    chart += '📝 **Total Votes:** ' + stats.totalVotes + '\n';
    chart += (poll.isAnonymous ? '🔒 Anonymous Poll' : '👁 Public Poll') + '\n';
    chart += (poll.allowMultiple ? '☑️ Multiple Choice' : '⭕ Single Choice') + '\n';
    
    return chart;
}

// ============================================================================
// Schedule Poll
// ============================================================================

function schedulePoll(poll: Poll) {
    if (!poll.scheduledAt) return;
    
    const delay = poll.scheduledAt.getTime() - Date.now();
    
    if (delay <= 0) {
        // Already past, publish immediately
        publishPoll(poll);
        return;
    }
    
    console.log('[Poll] Scheduled poll ' + poll.id + ' for ' + poll.scheduledAt.toISOString());
    
    const timer = setTimeout(() => {
        publishPoll(poll);
        scheduledTimers.delete(poll.id);
    }, delay);
    
    scheduledTimers.set(poll.id, timer);
}

async function publishPoll(poll: Poll) {
    try {
        const sent = await executeSendMessage(poll.creator, {
            rid: poll.roomId,
            msg: '',
            blocks: buildPollBlocks(poll, poll.creator)
        });
        
        if (sent?._id) {
            poll.messageId = sent._id;
            poll.scheduledAt = undefined;
        }
        
        console.log('[Poll] Published scheduled poll ' + poll.id);
    } catch (err) {
        console.error('[Poll] Failed to publish scheduled poll:', err);
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
        scheduledAt?: string;
    }) {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        const { roomId, question, options, allowMultiple, isAnonymous, scheduledAt } = data;
        
        if (!roomId) throw new Meteor.Error('invalid-room', 'Room required');
        const room = await Rooms.findOneById(roomId, { projection: { _id: 1 } });
        if (!room) throw new Meteor.Error('invalid-room', 'Room not found');
        if (!question?.trim()) throw new Meteor.Error('invalid-question', 'Question required');
        
        const cleanOptions = (options || []).map(o => o?.trim()).filter(Boolean);
        if (cleanOptions.length < 2) throw new Meteor.Error('invalid-options', 'Need at least 2 options');

        const creator = await Users.findOneById(userId, { projection: { name: 1, username: 1 } });
        const pollId = 'poll' + Date.now().toString(36);
        
        // Parse scheduled time
        let scheduledDate: Date | undefined;
        if (scheduledAt) {
            scheduledDate = new Date(scheduledAt);
            if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
                scheduledDate = undefined; // Invalid or past date, publish immediately
            }
        }
        
        const poll: Poll = {
            id: pollId,
            question: question.trim(),
            options: cleanOptions.map((text, i) => ({
                id: String.fromCharCode(65 + i),
                text,
                votes: 0,
                voters: [],
                voterNames: []
            })),
            creator: userId,
            creatorName: creator?.name || creator?.username || 'Unknown',
            roomId,
            allowMultiple: allowMultiple || false,
            isAnonymous: isAnonymous || false,
            isClosed: false,
            createdAt: new Date(),
            scheduledAt: scheduledDate,
            totalVoters: new Set()
        };

        polls.set(pollId, poll);

        // Handle scheduled polls
        if (scheduledDate) {
            schedulePoll(poll);
            return { 
                success: true, 
                pollId, 
                scheduled: true, 
                scheduledFor: scheduledDate.toISOString() 
            };
        }

        // Publish immediately
        try {
            const sent = await executeSendMessage(userId, {
                rid: roomId,
                msg: '',
                blocks: buildPollBlocks(poll, userId)
            });
            
            if (sent?._id) poll.messageId = sent._id;
            return { success: true, pollId };
        } catch (err: any) {
            polls.delete(pollId);
            throw new Meteor.Error('create-failed', err?.reason || 'Failed to create poll');
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
        
        // Get user display name for public polls
        const displayName = poll.isAnonymous ? '' : await getUserDisplayName(userId);
        
        if (poll.allowMultiple) {
            // Multiple choice: toggle this option
            if (wasSelected) {
                option.votes = Math.max(0, option.votes - 1);
                option.voters = option.voters.filter(v => v !== userId);
                option.voterNames = option.voterNames.filter((_, i) => option.voters[i] !== userId);
            } else {
                option.votes++;
                option.voters.push(userId);
                if (!poll.isAnonymous) option.voterNames.push(displayName);
            }
        } else {
            // Single choice: remove from all, add to this one
            poll.options.forEach(o => {
                const idx = o.voters.indexOf(userId);
                if (idx !== -1) {
                    o.votes = Math.max(0, o.votes - 1);
                    o.voters.splice(idx, 1);
                    o.voterNames.splice(idx, 1);
                }
            });
            
            if (!wasSelected) {
                option.votes++;
                option.voters.push(userId);
                if (!poll.isAnonymous) option.voterNames.push(displayName);
            }
        }

        // Update message
        if (poll.messageId) {
            const blocks = buildPollBlocks(poll, userId);
            await Messages.updateOne(
                { _id: poll.messageId },
                { $set: { blocks, _updatedAt: new Date() } }
            );
            await notifyOnMessageChange({ id: poll.messageId });
        }

        return { success: true, option: option.text, voted: !wasSelected };
    },

    async 'poll.close'(pollId: string) {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        const poll = polls.get(pollId);
        if (!poll) throw new Meteor.Error('not-found', 'Poll not found');
        if (poll.isClosed) throw new Meteor.Error('already-closed', 'Already closed');

        // Check permission
        const canClose = await canClosePoll(userId, poll);
        if (!canClose) {
            throw new Meteor.Error('not-authorized', 'Only poll creator or admin can close');
        }

        poll.isClosed = true;
        poll.closedAt = new Date();
        poll.closedBy = userId;

        // Cancel any scheduled timer
        const timer = scheduledTimers.get(pollId);
        if (timer) {
            clearTimeout(timer);
            scheduledTimers.delete(pollId);
        }

        if (poll.messageId) {
            const blocks = buildPollBlocks(poll);
            await Messages.updateOne(
                { _id: poll.messageId },
                { $set: { blocks, _updatedAt: new Date() } }
            );
            await notifyOnMessageChange({ id: poll.messageId });
        }

        return { success: true };
    },

    async 'poll.export'(pollId: string) {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        const poll = polls.get(pollId);
        if (!poll) throw new Meteor.Error('not-found', 'Poll not found');
        if (!poll.isClosed) throw new Meteor.Error('not-closed', 'Close the poll first');

        // Generate and send pie chart
        const chart = generatePieChart(poll);
        await executeSendMessage(userId, {
            rid: poll.roomId,
            msg: chart
        });

        return { success: true };
    },

    async 'poll.canClose'(pollId: string) {
        const userId = Meteor.userId();
        if (!userId) return false;
        
        const poll = polls.get(pollId);
        if (!poll) return false;
        
        return await canClosePoll(userId, poll);
    }
});

console.log('[Poll] System initialized');
