// Poll System - Complete Implementation
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
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

// MongoDB type for scheduled polls (serializable)
interface ScheduledPollDoc {
    _id: string;
    pollId: string;
    question: string;
    options: { id: string; text: string }[];
    creator: string;
    creatorName: string;
    roomId: string;
    allowMultiple: boolean;
    isAnonymous: boolean;
    scheduledAt: Date;
    createdAt: Date;
}

const polls = new Map<string, Poll>();
const scheduledTimers = new Map<string, ReturnType<typeof Meteor.setTimeout>>();

// MongoDB collection for persisting scheduled polls
const ScheduledPolls = new Mongo.Collection<ScheduledPollDoc>('rocketchat_scheduled_polls');

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
        // Show export buttons for closed polls (pie and bar options)
        blocks.push({
            type: 'actions',
            elements: [
                {
                    type: 'button',
                    text: { type: 'plain_text', text: '🥧 Pie Chart', emoji: true },
                    value: 'pollexport_' + poll.id + '_pie',
                    actionId: 'pollexport_' + poll.id + '_pie'
                },
                {
                    type: 'button',
                    text: { type: 'plain_text', text: '📊 Bar Graph', emoji: true },
                    value: 'pollexport_' + poll.id + '_bar',
                    actionId: 'pollexport_' + poll.id + '_bar'
                }
            ]
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
// Generate Pie Chart Image URL (using QuickChart.io)
// ============================================================================

function generatePieChartUrl(poll: Poll): string {
    const stats = calculateStats(poll);
    
    // Filter out options with 0 votes for cleaner chart
    const nonZeroOptions = stats.options.filter(o => o.votes > 0);
    
    // If no votes, show placeholder
    if (nonZeroOptions.length === 0) {
        const placeholderConfig = {
            type: 'pie',
            data: {
                labels: ['No votes yet'],
                datasets: [{ data: [1], backgroundColor: ['#6b7280'] }]
            },
            options: {
                plugins: {
                    legend: { display: false },
                    datalabels: { display: false }
                }
            }
        };
        const json = encodeURIComponent(JSON.stringify(placeholderConfig));
        return 'https://quickchart.io/chart?c=' + json + '&backgroundColor=%232f343d&width=400&height=400';
    }
    
    const labels = nonZeroOptions.map(o => o.text + ' (' + o.percentage + '%)');
    const data = nonZeroOptions.map(o => o.votes);
    const colors = ['#dc2626', '#2563eb', '#16a34a', '#ca8a04', '#9333ea', '#ea580c'];
    const bgColors = nonZeroOptions.map((_, i) => colors[i % colors.length]);
    
    const chartConfig = {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: bgColors,
                borderColor: '#2f343d',
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            layout: { padding: 20 },
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#e4e7ea',
                        font: { size: 14, weight: 'bold' },
                        padding: 15,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                datalabels: {
                    display: true,
                    color: '#ffffff',
                    font: { weight: 'bold', size: 16 },
                    textShadowColor: 'rgba(0,0,0,0.5)',
                    textShadowBlur: 4,
                    formatter: function(value: number) {
                        return value > 0 ? value : '';
                    }
                }
            }
        }
    };
    
    const chartJson = encodeURIComponent(JSON.stringify(chartConfig));
    // Use equal width and height for perfect circle
    return 'https://quickchart.io/chart?c=' + chartJson + '&backgroundColor=%232f343d&width=500&height=500&devicePixelRatio=2';
}

function generateBarChartUrl(poll: Poll): string {
    const stats = calculateStats(poll);
    const labels = stats.options.map(o => o.text + ' (' + o.percentage + '%)');
    const data = stats.options.map(o => o.votes);
    
    // Use Rocket.Chat theme colors - subtle blue gradient
    const chartConfig = {
        type: 'horizontalBar',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: '#156ff5',
                borderColor: '#1d74f5',
                borderWidth: 0,
                barThickness: 18,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: { left: 10, right: 30, top: 10, bottom: 10 } },
            plugins: {
                legend: { display: false },
                datalabels: {
                    display: true,
                    color: '#e4e7ea',
                    anchor: 'end',
                    align: 'end',
                    offset: 4,
                    font: { weight: 'bold', size: 13 },
                    formatter: function(value: number) {
                        return value;
                    }
                }
            },
            scales: {
                xAxes: [{
                    ticks: { 
                        beginAtZero: true, 
                        display: false
                    },
                    gridLines: { display: false }
                }],
                yAxes: [{
                    gridLines: { display: false },
                    ticks: { 
                        fontColor: '#e4e7ea', 
                        fontSize: 13,
                        fontStyle: 'bold',
                        padding: 8
                    }
                }]
            }
        }
    };
    
    const chartJson = encodeURIComponent(JSON.stringify(chartConfig));
    // Height based on number of options (50px per option + padding)
    const height = Math.max(150, stats.options.length * 50 + 40);
    return 'https://quickchart.io/chart?c=' + chartJson + '&backgroundColor=%232f343d&width=550&height=' + height + '&devicePixelRatio=2';
}

function generateChartMessage(poll: Poll, chartType: 'pie' | 'bar'): { msg: string; attachments: any[] } {
    const stats = calculateStats(poll);
    const emojis = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'];
    const maxVotes = Math.max(...stats.options.map(o => o.votes));
    
    // Generate chart URL based on type
    const chartUrl = chartType === 'bar' ? generateBarChartUrl(poll) : generatePieChartUrl(poll);
    const chartTitle = chartType === 'bar' ? '📊 Bar Chart Results' : '📊 Pie Chart Results';
    
    // Build text summary
    let summary = '📊 **POLL RESULTS**\n\n';
    summary += '**' + poll.question + '**\n\n';
    
    stats.options.forEach((opt, i) => {
        const emoji = emojis[i % emojis.length];
        const winner = (opt.votes === maxVotes && opt.votes > 0) ? ' 🏆' : '';
        summary += emoji + ' **' + opt.text + '**: ' + opt.percentage + '% (' + opt.votes + ')' + winner + '\n';
        
        if (!poll.isAnonymous && opt.voterNames.length > 0) {
            summary += '   _' + opt.voterNames.join(', ') + '_\n';
        }
    });
    
    summary += '\n👥 ' + stats.totalVoters + ' voters • 📝 ' + stats.totalVotes + ' votes';
    summary += '\n' + (poll.isAnonymous ? '🔒 Anonymous' : '👁 Public');
    
    // Return message with image attachment
    return {
        msg: summary,
        attachments: [{
            image_url: chartUrl,
            title: chartTitle
        }]
    };
}

// ============================================================================
// Schedule Poll - Persistent Implementation (survives server restart)
// ============================================================================

function saveScheduledPollToDb(poll: Poll) {
    if (!poll.scheduledAt) return;
    
    const doc: ScheduledPollDoc = {
        _id: poll.id,
        pollId: poll.id,
        question: poll.question,
        options: poll.options.map(o => ({ id: o.id, text: o.text })),
        creator: poll.creator,
        creatorName: poll.creatorName || 'Unknown',
        roomId: poll.roomId,
        allowMultiple: poll.allowMultiple,
        isAnonymous: poll.isAnonymous,
        scheduledAt: poll.scheduledAt,
        createdAt: poll.createdAt
    };
    
    // Upsert to MongoDB
    ScheduledPolls.upsert({ _id: poll.id }, { $set: doc });
    console.log('[Poll] 💾 Saved to MongoDB: ' + poll.id);
}

function removeScheduledPollFromDb(pollId: string) {
    ScheduledPolls.remove({ _id: pollId });
    console.log('[Poll] 🗑️ Removed from MongoDB: ' + pollId);
}

function recreatePollFromDoc(doc: ScheduledPollDoc): Poll {
    return {
        id: doc.pollId,
        question: doc.question,
        options: doc.options.map(o => ({
            id: o.id,
            text: o.text,
            votes: 0,
            voters: [],
            voterNames: []
        })),
        creator: doc.creator,
        creatorName: doc.creatorName,
        roomId: doc.roomId,
        allowMultiple: doc.allowMultiple,
        isAnonymous: doc.isAnonymous,
        isClosed: false,
        createdAt: doc.createdAt,
        scheduledAt: doc.scheduledAt,
        totalVoters: new Set()
    };
}

function schedulePoll(poll: Poll) {
    if (!poll.scheduledAt) return;
    
    // Save to MongoDB for persistence across restarts
    saveScheduledPollToDb(poll);
    
    // Clear any existing timer for this poll
    const existingTimer = scheduledTimers.get(poll.id);
    if (existingTimer) {
        Meteor.clearTimeout(existingTimer);
        scheduledTimers.delete(poll.id);
    }
    
    const now = Date.now();
    const scheduledTime = poll.scheduledAt.getTime();
    const delay = scheduledTime - now;
    
    console.log('[Poll] ⏰ Schedule info for ' + poll.id + ':');
    console.log('[Poll]   - Question: ' + poll.question);
    console.log('[Poll]   - Room: ' + poll.roomId);
    console.log('[Poll]   - Scheduled for: ' + poll.scheduledAt.toISOString());
    console.log('[Poll]   - Current time: ' + new Date(now).toISOString());
    console.log('[Poll]   - Delay: ' + Math.round(delay / 1000) + ' seconds');
    
    if (delay <= 0) {
        // Already past, publish immediately
        console.log('[Poll] ⚡ Scheduled time already passed, publishing now: ' + poll.id);
        void publishPollAsync(poll);
        return;
    }
    
    // Cap timeout to avoid overflow (max ~24 days)
    const maxDelay = 2147483647;
    const actualDelay = Math.min(delay, maxDelay);
    
    console.log('[Poll] ⏱️ Setting timer for ' + poll.id + ' (' + Math.round(actualDelay / 1000) + 's)');
    
    const timer = Meteor.setTimeout(() => {
        console.log('[Poll] 🔔 Timer fired for: ' + poll.id);
        scheduledTimers.delete(poll.id);
        
        // Get poll from memory or recreate from DB
        let currentPoll = polls.get(poll.id);
        if (!currentPoll) {
            // Try to get from MongoDB
            const doc = ScheduledPolls.findOne({ _id: poll.id });
            if (doc) {
                currentPoll = recreatePollFromDoc(doc);
                polls.set(poll.id, currentPoll);
            }
        }
        
        if (!currentPoll) {
            console.log('[Poll] ❌ Poll not found anywhere: ' + poll.id);
            return;
        }
        if (currentPoll.messageId) {
            console.log('[Poll] ⚠️ Already published: ' + poll.id);
            removeScheduledPollFromDb(poll.id);
            return;
        }
        
        void publishPollAsync(currentPoll);
    }, actualDelay);
    
    scheduledTimers.set(poll.id, timer);
    console.log('[Poll] ✅ Timer set successfully for: ' + poll.id);
}

async function publishPollAsync(poll: Poll): Promise<void> {
    // Prevent double-publishing
    if (poll.messageId) {
        console.log('[Poll] ⚠️ Already published (double-check): ' + poll.id);
        removeScheduledPollFromDb(poll.id);
        return;
    }
    
    try {
        console.log('[Poll] 📤 Publishing poll now: ' + poll.id + ' to room: ' + poll.roomId);
        
        const blocks = buildPollBlocks(poll, poll.creator);
        
        const sent = await executeSendMessage(poll.creator, {
            rid: poll.roomId,
            msg: '',
            blocks: blocks
        });
        
        if (sent?._id) {
            poll.messageId = sent._id;
            poll.scheduledAt = undefined;
            
            // Remove from MongoDB since it's now published
            removeScheduledPollFromDb(poll.id);
            
            console.log('[Poll] ✅ Successfully published: ' + poll.id + ' messageId: ' + sent._id);
        } else {
            console.error('[Poll] ❌ No message ID returned for: ' + poll.id);
        }
    } catch (err) {
        console.error('[Poll] ❌ Failed to publish scheduled poll ' + poll.id + ':', err);
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

    async 'poll.export'(pollId: string, chartType?: 'pie' | 'bar') {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        const poll = polls.get(pollId);
        if (!poll) throw new Meteor.Error('not-found', 'Poll not found');
        if (!poll.isClosed) throw new Meteor.Error('not-closed', 'Close the poll first');

        // Generate and send chart with image (default to pie)
        const type = chartType === 'bar' ? 'bar' : 'pie';
        const { msg, attachments } = generateChartMessage(poll, type);
        await executeSendMessage(userId, {
            rid: poll.roomId,
            msg,
            attachments
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

// ============================================================================
// Startup: Load and re-schedule pending polls from MongoDB
// ============================================================================

function loadScheduledPollsFromDb() {
    const now = Date.now();
    let rescheduled = 0;
    let published = 0;
    
    // Load all scheduled polls from MongoDB
    const docs = ScheduledPolls.find({}).fetch();
    console.log('[Poll] 📂 Found ' + docs.length + ' scheduled polls in MongoDB');
    
    docs.forEach((doc) => {
        console.log('[Poll] 📋 Loading scheduled poll: ' + doc.pollId);
        console.log('[Poll]   - Question: ' + doc.question);
        console.log('[Poll]   - Scheduled for: ' + doc.scheduledAt.toISOString());
        
        // Recreate poll object
        const poll = recreatePollFromDoc(doc);
        
        // Store in memory map
        polls.set(poll.id, poll);
        
        // Check if time has passed
        if (doc.scheduledAt.getTime() <= now) {
            console.log('[Poll] ⏰ Time passed, publishing immediately: ' + doc.pollId);
            void publishPollAsync(poll);
            published++;
        } else {
            // Set up timer (don't save to DB again since it's already there)
            const delay = doc.scheduledAt.getTime() - now;
            const actualDelay = Math.min(delay, 2147483647);
            
            console.log('[Poll] ⏱️ Re-scheduling: ' + doc.pollId + ' in ' + Math.round(actualDelay / 1000) + 's');
            
            const timer = Meteor.setTimeout(() => {
                console.log('[Poll] 🔔 Timer fired (from startup): ' + poll.id);
                scheduledTimers.delete(poll.id);
                
                const currentPoll = polls.get(poll.id);
                if (currentPoll && !currentPoll.messageId) {
                    void publishPollAsync(currentPoll);
                }
            }, actualDelay);
            
            scheduledTimers.set(poll.id, timer);
            rescheduled++;
        }
    });
    
    console.log('[Poll] ✅ Startup complete: ' + published + ' published, ' + rescheduled + ' rescheduled');
}

// Periodic check for any missed polls (runs every 30 seconds)
function periodicCheck() {
    const now = Date.now();
    const docs = ScheduledPolls.find({ scheduledAt: { $lte: new Date(now) } }).fetch();
    
    if (docs.length > 0) {
        console.log('[Poll] 🔄 Periodic check found ' + docs.length + ' pending polls');
        docs.forEach((doc) => {
            let poll = polls.get(doc.pollId);
            if (!poll) {
                poll = recreatePollFromDoc(doc);
                polls.set(poll.id, poll);
            }
            if (!poll.messageId) {
                void publishPollAsync(poll);
            }
        });
    }
}

// Run startup after Meteor is ready
Meteor.startup(() => {
    console.log('[Poll] 🚀 Starting poll system...');
    
    // Initial load after 3 seconds
    Meteor.setTimeout(() => {
        loadScheduledPollsFromDb();
    }, 3000);
    
    // Periodic check every 30 seconds for any missed polls
    Meteor.setInterval(() => {
        periodicCheck();
    }, 30000);
});

console.log('[Poll] System initialized');
