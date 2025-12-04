// Poll System - Full Featured with Charts, Export, Anonymous Voting, Scheduling
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
    voters: string[];       // User IDs (empty if anonymous)
    voterNames?: string[];  // Display names for non-anonymous polls
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
    scheduledMessageId?: string;
    createdAt: Date;
    totalVoters: Set<string>;  // Track unique voters
}

interface OptionStats {
    id: string;
    text: string;
    votes: number;
    percentage: number;
    isSelected: boolean;
    voterNames?: string[];
}

// In-memory poll storage
const polls = new Map<string, Poll>();

// Scheduled polls queue
const scheduledPolls = new Map<string, NodeJS.Timeout>();

// ============================================================================
// Progress Bar & Chart Generators
// ============================================================================

function generateProgressBar(percentage: number, width: number = 16): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return '▓'.repeat(filled) + '░'.repeat(empty);
}

function generateBarChart(options: OptionStats[]): string {
    const maxVotes = Math.max(...options.map(o => o.votes), 1);
    const barWidth = 12;
    
    return options.map(o => {
        const barLength = Math.round((o.votes / maxVotes) * barWidth);
        const bar = '█'.repeat(barLength) + '░'.repeat(barWidth - barLength);
        return `${o.text}: ${bar} ${o.votes}`;
    }).join('\n');
}

function generatePieChartText(options: OptionStats[]): string {
    // ASCII pie chart representation
    const total = options.reduce((sum, o) => sum + o.votes, 0);
    if (total === 0) return 'No votes yet';
    
    const symbols = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠', '⚫', '⚪', '🟤', '🔷'];
    
    return options.map((o, i) => {
        const symbol = symbols[i % symbols.length];
        const pct = Math.round((o.votes / total) * 100);
        return `${symbol} ${o.text}: ${pct}%`;
    }).join('\n');
}

// ============================================================================
// Vote Statistics Calculator
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
            voterNames: poll.isAnonymous ? undefined : o.voterNames
        }))
    };
}

// ============================================================================
// Export Functions
// ============================================================================

function exportToCSV(poll: Poll): string {
    const stats = calculateVoteStats(poll);
    const lines = [
        'Option,Votes,Percentage',
        ...stats.options.map(o => `"${o.text}",${o.votes},${o.percentage}%`)
    ];
    
    lines.push('');
    lines.push(`Total Votes,${stats.totalVotes}`);
    lines.push(`Total Voters,${stats.totalVoters}`);
    lines.push(`Poll Type,${poll.allowMultiple ? 'Multiple Choice' : 'Single Choice'}`);
    lines.push(`Anonymous,${poll.isAnonymous ? 'Yes' : 'No'}`);
    lines.push(`Status,${poll.isClosed ? 'Closed' : 'Open'}`);
    lines.push(`Created,${poll.createdAt.toISOString()}`);
    
    return lines.join('\n');
}

function exportToJSON(poll: Poll): object {
    const stats = calculateVoteStats(poll);
    return {
        id: poll.id,
        question: poll.question,
        options: stats.options.map(o => ({
            text: o.text,
            votes: o.votes,
            percentage: o.percentage,
            voters: poll.isAnonymous ? undefined : o.voterNames
        })),
        settings: {
            allowMultiple: poll.allowMultiple,
            isAnonymous: poll.isAnonymous,
            isClosed: poll.isClosed
        },
        stats: {
            totalVotes: stats.totalVotes,
            totalVoters: stats.totalVoters
        },
        metadata: {
            creator: poll.creatorName,
            createdAt: poll.createdAt,
            closedAt: poll.closedAt,
            closedBy: poll.closedBy
        }
    };
}

// ============================================================================
// Block Builder - Full Featured UI
// ============================================================================

function buildPollOptionRow(option: OptionStats, pollId: string, isClosed: boolean): any {
    const circle = option.isSelected ? '🔘' : '⭕';
    const progressBar = generateProgressBar(option.percentage, 14);
    const voteText = option.votes === 1 ? '1 vote' : `${option.votes} votes`;
    
    const displayText = [
        `${circle}  *${option.text}*`,
        `${progressBar}  ${option.percentage}% • ${voteText}`
    ].join('\n');
    
    const block: any = {
        type: 'section',
        blockId: `opt_${pollId}_${option.id}`,
        text: {
            type: 'mrkdwn',
            text: displayText
        }
    };
    
    // Only show vote button if poll is open
    if (!isClosed) {
        block.accessory = {
            type: 'button',
            text: {
                type: 'plain_text',
                text: option.isSelected ? '✓' : '○',
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

function buildPollBlocks(poll: Poll, viewerId?: string): any[] {
    const stats = calculateVoteStats(poll, viewerId);
    const blocks: any[] = [];
    
    // Status badge for closed/scheduled polls
    let statusBadge = '';
    if (poll.isClosed) {
        statusBadge = ' 🔒 *CLOSED*';
    } else if (poll.scheduledFor && poll.scheduledFor > new Date()) {
        statusBadge = ` ⏰ Scheduled for ${poll.scheduledFor.toLocaleString()}`;
    }
    
    // Header
    blocks.push({
        type: 'section',
        blockId: `header_${poll.id}`,
        text: {
            type: 'mrkdwn',
            text: `📊  *${poll.question}*${statusBadge}`
        }
    });
    
    // Anonymous indicator
    if (poll.isAnonymous) {
        blocks.push({
            type: 'context',
            blockId: `anon_${poll.id}`,
            elements: [{
                type: 'mrkdwn',
                text: '🔒 *Anonymous poll* - votes are private'
            }]
        });
    }
    
    // Options
    stats.options.forEach(option => {
        blocks.push(buildPollOptionRow(option, poll.id, poll.isClosed));
    });
    
    // Visual chart section (when there are votes)
    if (stats.totalVotes > 0) {
        blocks.push({
            type: 'context',
            blockId: `chart_${poll.id}`,
            elements: [{
                type: 'mrkdwn',
                text: `📈 *Results:* ${stats.totalVoters} voter${stats.totalVoters !== 1 ? 's' : ''}`
            }]
        });
    }
    
    // Footer with controls
    const choiceType = poll.allowMultiple ? '☑️ Multiple' : '○ Single';
    const totalText = `${stats.totalVotes} vote${stats.totalVotes !== 1 ? 's' : ''}`;
    
    blocks.push({
        type: 'context',
        blockId: `footer_${poll.id}`,
        elements: [{
            type: 'mrkdwn',
            text: `${choiceType} choice  •  ${totalText}  •  by ${poll.creatorName || 'Unknown'}`
        }]
    });
    
    // Action buttons (export, close - for admins/creators)
    if (!poll.isClosed) {
        blocks.push({
            type: 'actions',
            blockId: `actions_${poll.id}`,
            elements: [
                {
                    type: 'button',
                    text: { type: 'plain_text', text: '📥 Export', emoji: true },
                    value: `export_${poll.id}`,
                    actionId: `export_${poll.id}`,
                    appId: 'poll-app'
                },
                {
                    type: 'button',
                    text: { type: 'plain_text', text: '🔒 Close Poll', emoji: true },
                    value: `close_${poll.id}`,
                    actionId: `close_${poll.id}`,
                    appId: 'poll-app',
                    style: 'danger'
                }
            ]
        });
    } else {
        // Show export only for closed polls
        blocks.push({
            type: 'actions',
            blockId: `actions_${poll.id}`,
            elements: [
                {
                    type: 'button',
                    text: { type: 'plain_text', text: '📥 Export Results', emoji: true },
                    value: `export_${poll.id}`,
                    actionId: `export_${poll.id}`,
                    appId: 'poll-app'
                }
            ]
        });
    }
    
    return blocks;
}

// ============================================================================
// Poll Update & Scheduling
// ============================================================================

async function updatePollMessage(poll: Poll): Promise<boolean> {
    if (!poll.messageId) return false;
    
    try {
        const newBlocks = buildPollBlocks(poll);
        
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

async function publishScheduledPoll(pollId: string): Promise<void> {
    const poll = polls.get(pollId);
    if (!poll) return;
    
    try {
        const sentMessage = await executeSendMessage(poll.creator, {
            rid: poll.roomId,
            msg: '',
            blocks: buildPollBlocks(poll, poll.creator),
        });
        
        if (sentMessage?._id) {
            poll.messageId = sentMessage._id;
            poll.scheduledFor = undefined;
        }
        
        scheduledPolls.delete(pollId);
        console.log('[Poll] Scheduled poll published:', pollId);
    } catch (err) {
        console.error('[Poll] Failed to publish scheduled poll:', err);
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

    // Get user name for non-anonymous polls
    let userName = 'User';
    if (!poll.isAnonymous) {
        const user = await Users.findOneById(userId, { projection: { name: 1, username: 1 } });
        userName = user?.name || user?.username || 'User';
    }

    const wasSelected = option.voters.includes(userId);
    
    // Track unique voters
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
        // Single choice - remove from all first
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
// Meteor Methods
// ============================================================================

Meteor.methods({
    /**
     * Create a new poll with all options
     */
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

        // Get creator name
        const creator = await Users.findOneById(userId, { projection: { name: 1, username: 1 } });
        const creatorName = creator?.name || creator?.username || 'Unknown';

        const pollId = `p${Date.now().toString(36)}${Math.random().toString(36).substr(2, 4)}`;
        
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
            creatorName,
            roomId,
            allowMultiple: allowMultiple || false,
            isAnonymous: isAnonymous || false,
            isClosed: false,
            createdAt: new Date(),
            totalVoters: new Set()
        };

        // Handle scheduled polls
        if (scheduledFor && scheduledFor > new Date()) {
            poll.scheduledFor = scheduledFor;
            polls.set(pollId, poll);
            
            const delay = scheduledFor.getTime() - Date.now();
            const timeout = setTimeout(() => publishScheduledPoll(pollId), delay);
            scheduledPolls.set(pollId, timeout);
            
            console.log('[Poll] Scheduled for:', scheduledFor);
            return { success: true, pollId, scheduled: true, scheduledFor };
        }

        polls.set(pollId, poll);

        // Send poll message immediately
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
     * Vote on a poll
     */
    async 'poll.vote'(pollId: string, optionId: string) {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        const result = await handleVoteAction(pollId, optionId.toUpperCase(), userId);
        if (!result.success) throw new Meteor.Error('vote-failed', result.error);
        return result;
    },

    /**
     * Close a poll (creator or admin only)
     */
    async 'poll.close'(pollId: string) {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        const poll = polls.get(pollId);
        if (!poll) throw new Meteor.Error('not-found', 'Poll not found');

        // Check permission: creator or admin
        const isCreator = poll.creator === userId;
        const isAdmin = await hasPermissionAsync(userId, 'admin');
        
        if (!isCreator && !isAdmin) {
            throw new Meteor.Error('not-authorized', 'Only poll creator or admin can close');
        }

        poll.isClosed = true;
        poll.closedAt = new Date();
        poll.closedBy = userId;

        await updatePollMessage(poll);
        
        console.log('[Poll] Closed:', pollId);
        return { success: true };
    },

    /**
     * Export poll results
     */
    'poll.export'(pollId: string, format: 'csv' | 'json' = 'json') {
        const poll = polls.get(pollId);
        if (!poll) throw new Meteor.Error('not-found', 'Poll not found');

        if (format === 'csv') {
            return {
                success: true,
                format: 'csv',
                filename: `poll_${pollId}_results.csv`,
                data: exportToCSV(poll)
            };
        }
        
        return {
            success: true,
            format: 'json',
            filename: `poll_${pollId}_results.json`,
            data: exportToJSON(poll)
        };
    },

    /**
     * Get poll data with stats
     */
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

    /**
     * Get visual chart data
     */
    'poll.getChart'(pollId: string, type: 'bar' | 'pie' = 'bar') {
        const poll = polls.get(pollId);
        if (!poll) return null;

        const stats = calculateVoteStats(poll);
        
        return {
            type,
            data: type === 'bar' ? generateBarChart(stats.options) : generatePieChartText(stats.options),
            options: stats.options.map(o => ({
                label: o.text,
                value: o.votes,
                percentage: o.percentage
            }))
        };
    },

    /**
     * Handle block actions
     */
    async 'poll.blockAction'(data: { actionId: string; value: string }) {
        const userId = Meteor.userId();
        if (!userId) return { success: false };

        const { actionId, value } = data;

        // Vote action
        if (actionId.startsWith('vote_')) {
            const [pollId, optionId] = value.split('|');
            return await handleVoteAction(pollId, optionId, userId);
        }

        // Close action
        if (actionId.startsWith('close_')) {
            const pollId = value.replace('close_', '');
            try {
                await Meteor.callAsync('poll.close', pollId);
                return { success: true, action: 'closed' };
            } catch (e: any) {
                return { success: false, error: e.reason };
            }
        }

        // Export action
        if (actionId.startsWith('export_')) {
            const pollId = value.replace('export_', '');
            return Meteor.call('poll.export', pollId, 'json');
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
        await Meteor.callAsync('poll.close', params.trim());
        return { success: true };
    },
    options: { description: 'Close a poll', params: '<poll_id>' }
});

slashCommands.add({
    command: 'poll-export',
    callback: async function({ params }) {
        if (!params?.trim()) throw new Meteor.Error('usage', '/poll-export <poll_id> [csv|json]');
        const [pollId, format] = params.trim().split(/\s+/);
        return Meteor.call('poll.export', pollId, (format as 'csv' | 'json') || 'json');
    },
    options: { description: 'Export poll results', params: '<poll_id> [csv|json]' }
});

slashCommands.add({
    command: 'poll',
    callback: async function() {
        throw new Meteor.Error('info', 'Use the 📊 button to create a poll');
    },
    options: { description: 'Create a poll', params: '' }
});
