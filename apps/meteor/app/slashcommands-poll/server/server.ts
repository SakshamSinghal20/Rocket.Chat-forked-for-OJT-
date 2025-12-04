// Poll System - Using Message Attachments
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

// Helpers
function generateProgressBar(percentage: number): string {
    const width = 10;
    const filled = Math.round((percentage / 100) * width);
    return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

function calculateStats(poll: Poll) {
    const totalVotes = poll.options.reduce((sum, o) => sum + o.votes, 0);
    return {
        totalVotes,
        totalVoters: poll.totalVoters.size,
        options: poll.options.map(o => ({
            ...o,
            percentage: totalVotes > 0 ? Math.round((o.votes / totalVotes) * 100) : 0
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

// Build poll message with attachments
function buildPollMessage(poll: Poll): { msg: string; attachments: any[] } {
    const stats = calculateStats(poll);
    const status = poll.isClosed ? ' [CLOSED]' : '';
    
    // Main message text
    let msg = '📊 **' + poll.question + '**' + status;
    
    // Build attachments for options
    const attachments: any[] = [];
    const emojis = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'];
    
    stats.options.forEach((opt, i) => {
        const emoji = emojis[i % emojis.length];
        const bar = generateProgressBar(opt.percentage);
        
        attachments.push({
            color: ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316'][i % 6],
            title: emoji + ' ' + opt.id + '. ' + opt.text,
            text: bar + ' ' + opt.percentage + '% (' + opt.votes + ' votes)',
            collapsed: false
        });
    });
    
    // Footer attachment with stats
    const footerText = '📈 ' + stats.totalVotes + ' votes • 👥 ' + stats.totalVoters + ' voters\n' +
        (poll.isAnonymous ? '🔒 Anonymous' : '👁 Public') + ' • ' +
        (poll.allowMultiple ? '☑️ Multiple' : '⭕ Single') + '\n' +
        '🆔 Poll ID: ' + poll.id;
    
    let instructions = '';
    if (!poll.isClosed) {
        instructions = '\n\n**Vote:** `/vote ' + poll.id + ' A` (or B, C...)\n**Close:** `/closepoll ' + poll.id + '` (admin)';
    } else {
        instructions = '\n\n🔒 Poll closed on ' + (poll.closedAt ? poll.closedAt.toLocaleString() : 'unknown');
    }
    
    attachments.push({
        text: footerText + instructions,
        collapsed: false
    });
    
    return { msg, attachments };
}

// Update poll message
async function updatePollMessage(poll: Poll): Promise<boolean> {
    if (!poll.messageId) return false;
    
    try {
        const { msg, attachments } = buildPollMessage(poll);
        await Messages.updateOne(
            { _id: poll.messageId },
            { $set: { msg, attachments, _updatedAt: new Date() } }
        );
        await notifyOnMessageChange({ id: poll.messageId });
        return true;
    } catch (err) {
        console.error('[Poll] Update failed:', err);
        return false;
    }
}

// Meteor Methods
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
        
        if (!roomId) throw new Meteor.Error('invalid-room', 'Room required');
        const room = await Rooms.findOneById(roomId, { projection: { _id: 1 } });
        if (!room) throw new Meteor.Error('invalid-room', 'Room not found');
        if (!question?.trim()) throw new Meteor.Error('invalid-question', 'Question required');
        
        const cleanOptions = (options || []).map(o => o?.trim()).filter(Boolean);
        if (cleanOptions.length < 2) throw new Meteor.Error('invalid-options', 'Need 2+ options');

        const creator = await Users.findOneById(userId, { projection: { name: 1, username: 1 } });

        const pollId = 'poll' + Date.now().toString(36);
        
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
            const { msg, attachments } = buildPollMessage(poll);
            const sent = await executeSendMessage(userId, {
                rid: roomId,
                msg,
                attachments
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

        const normalizedId = optionId.toUpperCase().trim();
        const option = poll.options.find(o => o.id === normalizedId);
        if (!option) throw new Meteor.Error('invalid', 'Invalid option. Use A, B, C...');

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

        await updatePollMessage(poll);
        return { success: true, option: option.text };
    },

    async 'poll.close'(pollId: string) {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        const userIsAdmin = await isAdmin(userId);
        if (!userIsAdmin) {
            throw new Meteor.Error('not-authorized', 'Only admins can close polls');
        }

        const poll = polls.get(pollId);
        if (!poll) throw new Meteor.Error('not-found', 'Poll not found');
        if (poll.isClosed) throw new Meteor.Error('already-closed', 'Already closed');

        poll.isClosed = true;
        poll.closedAt = new Date();
        poll.closedBy = userId;

        await updatePollMessage(poll);
        return { success: true };
    }
});

// Slash Commands
import { slashCommands } from '../../utils/server/slashCommand';

slashCommands.add({
    command: 'vote',
    callback: async (_command: string, params: string, item: any) => {
        const userId = Meteor.userId();
        if (!userId) return;

        const parts = (params || '').trim().split(/\s+/);
        if (parts.length < 2) {
            await executeSendMessage(userId, {
                rid: item.rid,
                msg: '❌ **Usage:** `/vote <poll_id> <option>`\nExample: `/vote pollm4abc A`'
            });
            return;
        }

        try {
            // @ts-ignore
            const result = await Meteor.callAsync('poll.vote', parts[0], parts[1]);
            // Silent success - poll updates in place
        } catch (err: any) {
            await executeSendMessage(userId, {
                rid: item.rid,
                msg: '❌ ' + (err?.reason || 'Vote failed')
            });
        }
    },
    options: {
        description: 'Vote in a poll: /vote pollId A',
        params: '<poll_id> <option>'
    }
});

slashCommands.add({
    command: 'closepoll',
    callback: async (_command: string, params: string, item: any) => {
        const userId = Meteor.userId();
        if (!userId) return;

        const pollId = (params || '').trim();
        if (!pollId) {
            await executeSendMessage(userId, {
                rid: item.rid,
                msg: '❌ **Usage:** `/closepoll <poll_id>`'
            });
            return;
        }

        try {
            // @ts-ignore
            await Meteor.callAsync('poll.close', pollId);
            await executeSendMessage(userId, {
                rid: item.rid,
                msg: '✅ Poll closed!'
            });
        } catch (err: any) {
            await executeSendMessage(userId, {
                rid: item.rid,
                msg: '❌ ' + (err?.reason || 'Failed')
            });
        }
    },
    options: {
        description: 'Close a poll (admin only)',
        params: '<poll_id>'
    }
});

console.log('[Poll] System loaded');
