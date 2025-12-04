// Poll System - Complete Implementation
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
    scheduledAt?: Date;
    totalVoters: Set<string>;
}

// In-memory storage (consider using MongoDB for persistence)
const polls = new Map<string, Poll>();
const scheduledPolls = new Map<string, NodeJS.Timeout>();

// ============================================================================
// Helpers
// ============================================================================

function generateProgressBar(percentage: number): string {
    const width = 12;
    const filled = Math.round((percentage / 100) * width);
    return '▓'.repeat(filled) + '░'.repeat(width - filled);
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
// Generate Pie Chart (Text-based)
// ============================================================================

function generatePieChart(poll: Poll): string {
    const stats = calculateStats(poll);
    const maxVotes = Math.max(...stats.options.map(o => o.votes));
    
    let chart = `\n📊 **POLL RESULTS: PIE CHART**\n\n`;
    chart += `**${poll.question}**\n`;
    chart += `${'━'.repeat(30)}\n\n`;
    
    // Pie chart visualization using Unicode
    const pieSlices = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'];
    
    stats.options.forEach((opt, i) => {
        const slice = pieSlices[i % pieSlices.length];
        const isWinner = opt.votes === maxVotes && opt.votes > 0;
        const trophy = isWinner ? ' 🏆' : '';
        const bar = generateProgressBar(opt.percentage);
        
        chart += `${slice} **${opt.text}**${trophy}\n`;
        chart += `   ${bar} ${opt.percentage}% (${opt.votes} vote${opt.votes !== 1 ? 's' : ''})\n\n`;
    });
    
    chart += `${'━'.repeat(30)}\n`;
    chart += `👥 Total Voters: ${stats.totalVoters}\n`;
    chart += `📝 Total Votes: ${stats.totalVotes}\n`;
    chart += `${poll.isAnonymous ? '🔒 Anonymous Poll' : '👁 Public Poll'}\n`;
    chart += `${poll.allowMultiple ? '☑️ Multiple Choice' : '⭕ Single Choice'}\n`;
    
    return chart;
}

// ============================================================================
// Build Poll Message Text
// ============================================================================

function buildPollMessage(poll: Poll, viewerId?: string): string {
    const stats = calculateStats(poll, viewerId);
    
    let msg = `📊 **POLL${poll.isClosed ? ' [CLOSED 🔒]' : ''}**\n\n`;
    msg += `**${poll.question}**\n`;
    msg += `${poll.isAnonymous ? '🔒 Anonymous' : '👁 Public'} • ${poll.allowMultiple ? '☑️ Multiple' : '⭕ Single'}\n\n`;
    
    stats.options.forEach((opt, i) => {
        const emoji = ['🔴', '🔵', '🟢', '🟡', '🟣'][i % 5];
        const bar = generateProgressBar(opt.percentage);
        const selected = opt.isSelected ? ' ✓' : '';
        
        msg += `${emoji} **${opt.text}**${selected}\n`;
        msg += `   ${bar} ${opt.percentage}% (${opt.votes})\n\n`;
    });
    
    msg += `━━━━━━━━━━━━━━━\n`;
    msg += `📈 ${stats.totalVotes} vote${stats.totalVotes !== 1 ? 's' : ''} • `;
    msg += `👥 ${stats.totalVoters} voter${stats.totalVoters !== 1 ? 's' : ''}\n`;
    msg += `🆔 Poll ID: \`${poll.id}\`\n`;
    
    if (!poll.isClosed) {
        msg += `\n**To vote:** \`/poll-vote ${poll.id} A\` (or B, C, etc.)\n`;
        msg += `**To close (admin):** \`/poll-close ${poll.id}\``;
    } else {
        msg += `\n**To export results:** \`/poll-export ${poll.id}\``;
    }
    
    return msg;
}

// ============================================================================
// Update Poll Message
// ============================================================================

async function updatePollMessage(poll: Poll): Promise<boolean> {
    if (!poll.messageId) return false;
    
    try {
        const msg = buildPollMessage(poll);
        
        await Messages.updateOne(
            { _id: poll.messageId },
            { $set: { msg, _updatedAt: new Date() } }
        );
        
        await notifyOnMessageChange({ id: poll.messageId });
        return true;
    } catch (err) {
        console.error('[Poll] Update failed:', err);
        return false;
    }
}

// ============================================================================
// Schedule Poll
// ============================================================================

function schedulePoll(poll: Poll) {
    if (!poll.scheduledAt) return;
    
    const delay = poll.scheduledAt.getTime() - Date.now();
    if (delay <= 0) {
        // Already past, publish now
        publishScheduledPoll(poll);
        return;
    }
    
    const timeout = setTimeout(() => {
        publishScheduledPoll(poll);
    }, delay);
    
    scheduledPolls.set(poll.id, timeout);
}

async function publishScheduledPoll(poll: Poll) {
    try {
        const sent = await executeSendMessage(poll.creator, {
            rid: poll.roomId,
            msg: buildPollMessage(poll, poll.creator),
        });
        
        if (sent?._id) {
            poll.messageId = sent._id;
            poll.scheduledAt = undefined;
        }
    } catch (err) {
        console.error('[Poll] Failed to publish scheduled poll:', err);
    }
    
    scheduledPolls.delete(poll.id);
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
        
        if (!roomId) throw new Meteor.Error('invalid-room', 'Room ID is required');
        const room = await Rooms.findOneById(roomId, { projection: { _id: 1 } });
        if (!room) throw new Meteor.Error('invalid-room', 'Room not found');
        if (!question?.trim()) throw new Meteor.Error('invalid-question', 'Question is required');
        
        const cleanOptions = (options || []).map(o => o?.trim()).filter(Boolean);
        if (cleanOptions.length < 2) throw new Meteor.Error('invalid-options', 'At least 2 options required');

        const creator = await Users.findOneById(userId, { projection: { name: 1, username: 1 } });

        const pollId = `poll_${Date.now().toString(36)}`;
        
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
            scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
            totalVoters: new Set()
        };

        polls.set(pollId, poll);

        // Handle scheduled polls
        if (poll.scheduledAt && poll.scheduledAt > new Date()) {
            schedulePoll(poll);
            return { 
                success: true, 
                pollId,
                scheduled: true,
                scheduledFor: poll.scheduledAt
            };
        }

        try {
            const sent = await executeSendMessage(userId, {
                rid: roomId,
                msg: buildPollMessage(poll, userId),
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
        if (!poll) throw new Meteor.Error('not-found', 'Poll not found. It may have expired.');
        if (poll.isClosed) throw new Meteor.Error('closed', 'This poll is closed');

        const normalizedOptionId = optionId.toUpperCase().trim();
        const option = poll.options.find(o => o.id === normalizedOptionId);
        if (!option) {
            const validOptions = poll.options.map(o => o.id).join(', ');
            throw new Meteor.Error('invalid', `Invalid option. Valid options: ${validOptions}`);
        }

        const wasSelected = option.voters.includes(userId);
        poll.totalVoters.add(userId);
        
        if (poll.allowMultiple) {
            // Toggle vote for multiple choice
            if (wasSelected) {
                option.votes = Math.max(0, option.votes - 1);
                option.voters = option.voters.filter(v => v !== userId);
            } else {
                option.votes++;
                option.voters.push(userId);
            }
        } else {
            // Single choice - remove previous vote first
            poll.options.forEach(o => {
                const idx = o.voters.indexOf(userId);
                if (idx !== -1) {
                    o.votes = Math.max(0, o.votes - 1);
                    o.voters.splice(idx, 1);
                }
            });
            
            // Add new vote (unless they clicked the same option to unvote)
            if (!wasSelected) {
                option.votes++;
                option.voters.push(userId);
            }
        }

        // Update the poll message
        await updatePollMessage(poll);

        return { 
            success: true, 
            voted: !wasSelected,
            option: option.text
        };
    },

    async 'poll.close'(pollId: string) {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        // Check admin permission
        const userIsAdmin = await isAdmin(userId);
        if (!userIsAdmin) {
            throw new Meteor.Error('not-authorized', 'Only admins can close polls');
        }

        const poll = polls.get(pollId);
        if (!poll) throw new Meteor.Error('not-found', 'Poll not found');
        if (poll.isClosed) throw new Meteor.Error('already-closed', 'Poll is already closed');

        // Close the poll
        poll.isClosed = true;
        poll.closedAt = new Date();
        poll.closedBy = userId;

        // Update poll message
        await updatePollMessage(poll);

        return { success: true, message: 'Poll closed. Use /poll-export to view results.' };
    },

    async 'poll.export'(pollId: string) {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        const poll = polls.get(pollId);
        if (!poll) throw new Meteor.Error('not-found', 'Poll not found');
        if (!poll.isClosed) throw new Meteor.Error('not-closed', 'Close the poll first before exporting');

        // Generate and send pie chart
        const pieChart = generatePieChart(poll);
        await executeSendMessage(userId, {
            rid: poll.roomId,
            msg: pieChart,
        });

        return { success: true };
    },

    async 'poll.list'() {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        const userPolls: any[] = [];
        polls.forEach((poll) => {
            userPolls.push({
                id: poll.id,
                question: poll.question,
                isClosed: poll.isClosed,
                totalVotes: poll.options.reduce((sum, o) => sum + o.votes, 0),
                createdAt: poll.createdAt
            });
        });

        return userPolls;
    },

    async 'poll.get'(pollId: string) {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        const poll = polls.get(pollId);
        if (!poll) throw new Meteor.Error('not-found', 'Poll not found');

        return {
            id: poll.id,
            question: poll.question,
            options: poll.options.map(o => ({
                id: o.id,
                text: o.text,
                votes: o.votes,
                isSelected: o.voters.includes(userId)
            })),
            isClosed: poll.isClosed,
            allowMultiple: poll.allowMultiple,
            isAnonymous: poll.isAnonymous
        };
    }
});

// ============================================================================
// Slash Commands
// ============================================================================

import { slashCommands } from '../../utils/server/slashCommand';

// Vote command
slashCommands.add({
    command: 'poll-vote',
    callback: async function(_command: string, params: string, item: any) {
        const userId = Meteor.userId();
        if (!userId) return;

        if (!params?.trim()) {
            await executeSendMessage(userId, {
                rid: item.rid,
                msg: '❌ **Usage:** `/poll-vote <poll_id> <option>`\nExample: `/poll-vote poll_abc123 A`',
            });
            return;
        }

        const [pollId, optionId] = params.trim().split(/\s+/);
        
        if (!pollId || !optionId) {
            await executeSendMessage(userId, {
                rid: item.rid,
                msg: '❌ **Usage:** `/poll-vote <poll_id> <option>`\nExample: `/poll-vote poll_abc123 A`',
            });
            return;
        }

        try {
            const result = await Meteor.callAsync('poll.vote', pollId, optionId);
            // Vote registered silently - poll updates in place
        } catch (err: any) {
            await executeSendMessage(userId, {
                rid: item.rid,
                msg: `❌ **Vote failed:** ${err?.reason || err?.message || 'Unknown error'}`,
            });
        }
    },
    options: {
        description: 'Vote in a poll',
        params: '<poll_id> <option>',
        permission: 'send-message'
    }
});

// Close command
slashCommands.add({
    command: 'poll-close',
    callback: async function(_command: string, params: string, item: any) {
        const userId = Meteor.userId();
        if (!userId) return;

        const pollId = params?.trim();
        if (!pollId) {
            await executeSendMessage(userId, {
                rid: item.rid,
                msg: '❌ **Usage:** `/poll-close <poll_id>`',
            });
            return;
        }

        try {
            await Meteor.callAsync('poll.close', pollId);
            await executeSendMessage(userId, {
                rid: item.rid,
                msg: `✅ **Poll closed!** Use \`/poll-export ${pollId}\` to see the pie chart results.`,
            });
        } catch (err: any) {
            await executeSendMessage(userId, {
                rid: item.rid,
                msg: `❌ **Close failed:** ${err?.reason || err?.message || 'Unknown error'}`,
            });
        }
    },
    options: {
        description: 'Close a poll (Admin only)',
        params: '<poll_id>',
        permission: 'send-message'
    }
});

// Export command
slashCommands.add({
    command: 'poll-export',
    callback: async function(_command: string, params: string, item: any) {
        const userId = Meteor.userId();
        if (!userId) return;

        const pollId = params?.trim();
        if (!pollId) {
            await executeSendMessage(userId, {
                rid: item.rid,
                msg: '❌ **Usage:** `/poll-export <poll_id>`',
            });
            return;
        }

        try {
            await Meteor.callAsync('poll.export', pollId);
        } catch (err: any) {
            await executeSendMessage(userId, {
                rid: item.rid,
                msg: `❌ **Export failed:** ${err?.reason || err?.message || 'Unknown error'}`,
            });
        }
    },
    options: {
        description: 'Export poll results as pie chart',
        params: '<poll_id>',
        permission: 'send-message'
    }
});

console.log('[Poll] System initialized');
