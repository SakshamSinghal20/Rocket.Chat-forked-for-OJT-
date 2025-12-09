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
    chartsExported?: boolean;
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

    // Header with status
    const status = poll.isClosed ? ' 🔒 CLOSED' : '';
    blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '📊 *' + poll.question + '*' + status }
    });

    // Poll settings info (NO poll ID shown)
    const info = [
        poll.isAnonymous ? '🔒 Anonymous' : '👁 Public',
        poll.allowMultiple ? '☑️ Multiple choice' : '○ Single choice'
    ];
    blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: info.join(' • ') }]
    });

    // Options - Clean layout without voter names inline
    stats.options.forEach((opt, i) => {
        const bar = generateProgressBar(opt.percentage);
        // Use text symbols instead of emojis for cleaner look
        const selector = opt.isSelected ? '●' : '○';
        const count = opt.votes;

        // Clean format: Selector OptionText | Progress Bar | Count
        let optionLine = selector + ' *' + opt.text + '*';
        optionLine += '\n     ' + bar + '  ' + opt.percentage + '%  •  ' + count + ' vote' + (count !== 1 ? 's' : '');

        const block: any = {
            type: 'section',
            text: { type: 'mrkdwn', text: optionLine }
        };

        // Add vote button only if poll is open
        if (!poll.isClosed) {
            block.accessory = {
                type: 'button',
                text: { type: 'plain_text', text: opt.isSelected ? '✓' : '○', emoji: false },
                value: 'pollvote_' + poll.id + '_' + opt.id,
                actionId: 'pollvote_' + poll.id + '_' + opt.id
            };
        }

        blocks.push(block);
    });

    // Divider
    blocks.push({ type: 'divider' });

    // Stats footer with View Voters button for public polls
    const footerText = '📈 ' + stats.totalVotes + ' vote' + (stats.totalVotes !== 1 ? 's' : '') +
        '  •  👥 ' + stats.totalVoters + ' voter' + (stats.totalVoters !== 1 ? 's' : '') +
        '  •  by ' + (poll.creatorName || 'Unknown');

    blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: footerText }]
    });

    // Action buttons row
    const actionElements: any[] = [];

    // View Voters button (only for public polls with votes)
    if (!poll.isAnonymous && stats.totalVotes > 0) {
        actionElements.push({
            type: 'button',
            text: { type: 'plain_text', text: '👁 View Voters', emoji: true },
            value: 'pollviewers_' + poll.id,
            actionId: 'pollviewers_' + poll.id
        });
    }

    if (!poll.isClosed) {
        actionElements.push({
            type: 'button',
            text: { type: 'plain_text', text: '🔒 Close Poll', emoji: true },
            value: 'pollclose_' + poll.id,
            actionId: 'pollclose_' + poll.id,
            style: 'danger'
        });
    } else if (!poll.chartsExported) {
        // Single export button for closed polls - exports both charts (only if not already exported)
        actionElements.push({
            type: 'button',
            text: { type: 'plain_text', text: '📊 Export Charts', emoji: true },
            value: 'pollexport_' + poll.id + '_both',
            actionId: 'pollexport_' + poll.id + '_both'
        });
    }

    if (actionElements.length > 0) {
        blocks.push({
            type: 'actions',
            elements: actionElements
        });
    }

    // Closed timestamp
    if (poll.isClosed && poll.closedAt) {
        blocks.push({
            type: 'context',
            elements: [{ type: 'mrkdwn', text: '🔒 _Closed on ' + poll.closedAt.toLocaleString() + '_' }]
        });
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
                    formatter: function (value: number) {
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
    const labels = stats.options.map(o => o.text);
    const data = stats.options.map(o => o.votes);
    const colors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];
    const bgColors = stats.options.map((_, i) => colors[i % colors.length]);

    // Vertical bar chart (bars go up from bottom) - NO legend
    const chartConfig = {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: bgColors,
                borderColor: bgColors,
                borderWidth: 0,
                borderRadius: 4,
                label: '' // Empty label to hide legend
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            legend: { display: false }, // Chart.js 2.x format
            layout: {
                padding: { left: 20, right: 20, top: 20, bottom: 20 }
            },
            plugins: {
                legend: false, // Disable legend completely
                datalabels: {
                    display: true,
                    color: '#ffffff',
                    anchor: 'end',
                    align: 'top',
                    offset: 4,
                    font: { weight: 'bold', size: 14 },
                    formatter: function (value: number) {
                        return value;
                    }
                }
            },
            scales: {
                xAxes: [{
                    gridLines: { display: false },
                    ticks: {
                        fontColor: '#e5e7eb',
                        fontSize: 13,
                        fontStyle: 'bold'
                    }
                }],
                yAxes: [{
                    ticks: {
                        beginAtZero: true,
                        fontColor: '#9ca3af',
                        fontSize: 12,
                        stepSize: 1
                    },
                    gridLines: {
                        display: true,
                        color: 'rgba(75, 85, 99, 0.3)',
                        drawBorder: false
                    }
                }]
            }
        }
    };

    const chartJson = encodeURIComponent(JSON.stringify(chartConfig));
    // Square-ish chart, no stretching
    return 'https://quickchart.io/chart?c=' + chartJson + '&backgroundColor=%231f2937&width=500&height=400&devicePixelRatio=2';
}

function generateChartMessage(poll: Poll, chartType: 'pie' | 'bar' | 'both'): { msg: string; attachments: any[]; blocks: any[] } {
    const stats = calculateStats(poll);
    const emojis = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'];
    const maxVotes = Math.max(...stats.options.map(o => o.votes));

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

    // Generate attachments based on type
    const attachments: any[] = [];

    if (chartType === 'both' || chartType === 'pie') {
        attachments.push({
            image_url: generatePieChartUrl(poll),
            title: '🥧 Pie Chart'
        });
    }

    if (chartType === 'both' || chartType === 'bar') {
        attachments.push({
            image_url: generateBarChartUrl(poll),
            title: '📊 Bar Chart'
        });
    }

    // Add action buttons to the results message (only View Voters - charts already exported)
    const blocks: any[] = [];

    // Only show View Voters button for public polls
    if (!poll.isAnonymous) {
        blocks.push({
            type: 'actions',
            elements: [
                {
                    type: 'button',
                    text: { type: 'plain_text', text: '👁 View Voters', emoji: true },
                    value: 'pollviewers_' + poll.id,
                    actionId: 'pollviewers_' + poll.id
                }
            ]
        });
    }

    return { msg: summary, attachments, blocks };
}

// ============================================================================
// Schedule Poll - Persistent Implementation (survives server restart)
// ============================================================================

async function saveScheduledPollToDb(poll: Poll): Promise<void> {
    if (!poll.scheduledAt) return;

    try {
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

        // Upsert to MongoDB using async method
        await ScheduledPolls.upsertAsync({ _id: poll.id }, { $set: doc });
        console.log('[Poll] 💾 Saved to MongoDB: ' + poll.id);
    } catch (err: any) {
        console.error('[Poll] ❌ Failed to save to MongoDB: ' + poll.id);
        console.error('[Poll]   - Error:', err?.message || err);
        throw err; // Re-throw so caller can handle
    }
}

async function removeScheduledPollFromDb(pollId: string): Promise<void> {
    try {
        await ScheduledPolls.removeAsync({ _id: pollId });
        console.log('[Poll] 🗑️ Removed from MongoDB: ' + pollId);
    } catch (err: any) {
        console.error('[Poll] ⚠️ Failed to remove from MongoDB: ' + pollId);
        console.error('[Poll]   - Error:', err?.message || err);
        // Don't throw - removal failure shouldn't break publishing
    }
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

async function schedulePoll(poll: Poll): Promise<void> {
    if (!poll.scheduledAt) return;

    // Save to MongoDB for persistence across restarts
    await saveScheduledPollToDb(poll);

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

    const pollId = poll.id; // Capture for closure
    const timer = Meteor.setTimeout(async () => {
        console.log('[Poll] 🔔 Timer fired for: ' + pollId);
        scheduledTimers.delete(pollId);

        // Get poll from memory or recreate from DB
        let currentPoll = polls.get(pollId);
        if (!currentPoll) {
            // Try to get from MongoDB
            const doc = await ScheduledPolls.findOneAsync({ _id: pollId });
            if (doc) {
                currentPoll = recreatePollFromDoc(doc);
                polls.set(pollId, currentPoll);
            }
        }

        if (!currentPoll) {
            console.log('[Poll] ❌ Poll not found anywhere: ' + pollId);
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
        console.log('[Poll] 📤 Publishing scheduled poll: ' + poll.id);
        console.log('[Poll]   - Room: ' + poll.roomId);
        console.log('[Poll]   - Creator: ' + poll.creator);
        console.log('[Poll]   - Question: ' + poll.question);

        // Validate room exists
        const room = await Rooms.findOneById(poll.roomId);
        if (!room) {
            console.error('[Poll] ❌ Room not found: ' + poll.roomId);
            removeScheduledPollFromDb(poll.id);
            return;
        }
        console.log('[Poll]   - Room verified: ' + room.name);

        // Validate user exists
        const user = await Users.findOneById(poll.creator);
        if (!user) {
            console.error('[Poll] ❌ Creator user not found: ' + poll.creator);
            removeScheduledPollFromDb(poll.id);
            return;
        }
        console.log('[Poll]   - User verified: ' + user.username);

        // Build poll blocks - no viewerId for global broadcast
        // Selection state should be neutral since messages are shared across all users
        const blocks = buildPollBlocks(poll); // No viewerId = neutral state
        console.log('[Poll]   - Blocks built: ' + blocks.length + ' blocks');

        // Send message
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

            console.log('[Poll] ✅ Successfully published: ' + poll.id);
            console.log('[Poll]   - Message ID: ' + sent._id);
        } else {
            console.error('[Poll] ❌ No message ID returned for: ' + poll.id);
            console.error('[Poll]   - Response:', JSON.stringify(sent));
        }
    } catch (err: any) {
        console.error('[Poll] ❌ Failed to publish scheduled poll ' + poll.id);
        console.error('[Poll]   - Error type:', err?.constructor?.name);
        console.error('[Poll]   - Error message:', err?.message || err?.reason || String(err));
        console.error('[Poll]   - Error details:', err?.details || 'none');
        console.error('[Poll]   - Full error:', err);

        // Don't remove from DB on error - allow retry
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

        // Parse scheduled time (datetime-local format: "2024-12-04T09:03")
        // The input is in user's local timezone, so we need to parse it correctly
        let scheduledDate: Date | undefined;
        if (scheduledAt) {
            console.log('[Poll] Parsing scheduledAt:', scheduledAt);

            // datetime-local format doesn't include timezone
            // Parse as local time by creating date directly from the string
            // The string format "2024-12-04T09:03" is already local time
            scheduledDate = new Date(scheduledAt);

            // If the date seems wrong (timezone issue), the input might be treated as UTC
            // In that case, we need to NOT convert - the Date constructor with ISO-like 
            // format without Z treats it as local time in modern browsers/Node

            console.log('[Poll] Input string:', scheduledAt);
            console.log('[Poll] Parsed as:', scheduledDate.toString());
            console.log('[Poll] In ISO:', scheduledDate.toISOString());
            console.log('[Poll] Current time:', new Date().toString());
            console.log('[Poll] Is valid:', !isNaN(scheduledDate.getTime()));
            console.log('[Poll] Is in future:', scheduledDate > new Date());

            if (isNaN(scheduledDate.getTime())) {
                console.log('[Poll] ⚠️ Invalid date format, publishing immediately');
                scheduledDate = undefined;
            } else if (scheduledDate <= new Date()) {
                console.log('[Poll] ⚠️ Date is in past or now, publishing immediately');
                scheduledDate = undefined;
            } else {
                const delayMs = scheduledDate.getTime() - Date.now();
                console.log('[Poll] ✅ Valid future date, will schedule in ' + Math.round(delayMs / 1000) + ' seconds');
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
            try {
                console.log('[Poll] Creating scheduled poll: ' + pollId);
                console.log('[Poll]   - Question: ' + question);
                console.log('[Poll]   - Scheduled for: ' + scheduledDate.toISOString());
                console.log('[Poll]   - Room: ' + roomId);

                await schedulePoll(poll);

                console.log('[Poll] ✅ Scheduled poll created successfully: ' + pollId);

                return {
                    success: true,
                    pollId,
                    scheduled: true,
                    scheduledFor: scheduledDate.toISOString()
                };
            } catch (err: any) {
                console.error('[Poll] ❌ Failed to schedule poll: ' + pollId);
                console.error('[Poll]   - Error:', err?.message || err);
                polls.delete(pollId);
                throw new Meteor.Error('schedule-failed', 'Failed to schedule poll: ' + (err?.message || 'Unknown error'));
            }
        }

        // Publish immediately
        try {
            console.log('[Poll] Creating immediate poll: ' + pollId);

            // Don't pass viewerId - the poll message is global, not per-user
            // Selection state should start neutral for everyone
            const sent = await executeSendMessage(userId, {
                rid: roomId,
                msg: '',
                blocks: buildPollBlocks(poll) // No viewerId = neutral selection state
            });

            if (sent?._id) {
                poll.messageId = sent._id;
                console.log('[Poll] ✅ Poll created: ' + pollId + ' -> ' + sent._id);
            }
            return { success: true, pollId };
        } catch (err: any) {
            console.error('[Poll] ❌ Failed to create poll: ' + pollId);
            console.error('[Poll]   - Error:', err?.message || err?.reason || err);
            polls.delete(pollId);
            throw new Meteor.Error('create-failed', err?.reason || err?.message || 'Failed to create poll');
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

        // Helper to safely remove voter from an option
        const removeVoterFromOption = (opt: PollOption, odUserId: string) => {
            const idx = opt.voters.indexOf(odUserId);
            if (idx !== -1) {
                opt.votes = Math.max(0, opt.votes - 1);
                opt.voters.splice(idx, 1);
                opt.voterNames.splice(idx, 1);
            }
        };

        // Helper to safely add voter to an option (prevents duplicates)
        const addVoterToOption = (opt: PollOption, odUserId: string, name: string) => {
            // Only add if not already in the list (prevent duplicates)
            if (!opt.voters.includes(odUserId)) {
                opt.votes++;
                opt.voters.push(odUserId);
                if (!poll.isAnonymous && name) {
                    opt.voterNames.push(name);
                }
            }
        };

        if (poll.allowMultiple) {
            // Multiple choice: toggle this option
            if (wasSelected) {
                removeVoterFromOption(option, userId);
            } else {
                addVoterToOption(option, userId, displayName);
            }
        } else {
            // Single choice: remove from all options first
            poll.options.forEach(o => {
                removeVoterFromOption(o, userId);
            });

            // Add to selected option (only if not previously selected)
            if (!wasSelected) {
                addVoterToOption(option, userId, displayName);
            }
        }

        // Update message - NOTE: Don't pass viewerId here because the message is
        // broadcast to everyone. Selection state should be neutral (not pre-ticked)
        // since each user's selection state is individual, not global.
        if (poll.messageId) {
            const blocks = buildPollBlocks(poll); // No viewerId = no pre-selections
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
            const blocks = buildPollBlocks(poll); // No viewerId for global broadcast
            await Messages.updateOne(
                { _id: poll.messageId },
                { $set: { blocks, _updatedAt: new Date() } }
            );
            await notifyOnMessageChange({ id: poll.messageId });
        }

        return { success: true };
    },

    async 'poll.export'(pollId: string, chartType?: 'pie' | 'bar' | 'both') {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        const poll = polls.get(pollId);
        if (!poll) throw new Meteor.Error('not-found', 'Poll not found');
        if (!poll.isClosed) throw new Meteor.Error('not-closed', 'Close the poll first');
        if (poll.chartsExported) throw new Meteor.Error('already-exported', 'Charts already exported');

        // Mark as exported BEFORE sending to prevent double-clicks
        poll.chartsExported = true;

        // Generate and send chart(s) with action buttons
        const type = chartType === 'bar' ? 'bar' : (chartType === 'both' ? 'both' : 'pie');
        const { msg, attachments, blocks } = generateChartMessage(poll, type);
        await executeSendMessage(userId, {
            rid: poll.roomId,
            msg,
            attachments,
            blocks
        });

        // Update the original poll message to remove the Export Charts button
        if (poll.messageId) {
            const updatedBlocks = buildPollBlocks(poll);
            await Messages.updateOne(
                { _id: poll.messageId },
                { $set: { blocks: updatedBlocks, _updatedAt: new Date() } }
            );
            await notifyOnMessageChange({ id: poll.messageId });
        }

        return { success: true };
    },

    async 'poll.canClose'(pollId: string) {
        const userId = Meteor.userId();
        if (!userId) return false;

        const poll = polls.get(pollId);
        if (!poll) return false;

        return await canClosePoll(userId, poll);
    },

    // Get voters for View Voters popup
    async 'poll.getVoters'(pollId: string) {
        const userId = Meteor.userId();
        if (!userId) throw new Meteor.Error('not-authorized');

        const poll = polls.get(pollId);
        if (!poll) throw new Meteor.Error('not-found', 'Poll not found');

        // Don't reveal voters for anonymous polls
        if (poll.isAnonymous) {
            return {
                question: poll.question,
                isAnonymous: true,
                options: poll.options.map(o => ({
                    text: o.text,
                    votes: o.votes,
                    voters: [] // Empty for anonymous
                }))
            };
        }

        // Return voter names for public polls
        return {
            question: poll.question,
            isAnonymous: false,
            options: poll.options.map(o => ({
                text: o.text,
                votes: o.votes,
                voters: o.voterNames
            }))
        };
    }
});

// ============================================================================
// Startup: Load and re-schedule pending polls from MongoDB
// ============================================================================

async function loadScheduledPollsFromDb(): Promise<void> {
    const now = Date.now();
    let rescheduled = 0;
    let published = 0;

    try {
        // Load all scheduled polls from MongoDB using async
        const docs = await ScheduledPolls.find({}).fetchAsync();
        console.log('[Poll] 📂 Found ' + docs.length + ' scheduled polls in MongoDB');

        for (const doc of docs) {
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

                const pollId = poll.id;
                const timer = Meteor.setTimeout(() => {
                    console.log('[Poll] 🔔 Timer fired (from startup): ' + pollId);
                    scheduledTimers.delete(pollId);

                    const currentPoll = polls.get(pollId);
                    if (currentPoll && !currentPoll.messageId) {
                        void publishPollAsync(currentPoll);
                    }
                }, actualDelay);

                scheduledTimers.set(poll.id, timer);
                rescheduled++;
            }
        }

        console.log('[Poll] ✅ Startup complete: ' + published + ' published, ' + rescheduled + ' rescheduled');
    } catch (err: any) {
        console.error('[Poll] ❌ Failed to load scheduled polls:', err?.message || err);
    }
}

// Periodic check for any missed polls (runs every 15 seconds)
async function periodicCheck(): Promise<void> {
    try {
        const now = Date.now();

        // Find all scheduled polls that should have been published by now
        const docs = await ScheduledPolls.find({ scheduledAt: { $lte: new Date(now) } }).fetchAsync();

        if (docs.length > 0) {
            console.log('[Poll] 🔄 Periodic check found ' + docs.length + ' due polls at ' + new Date().toISOString());
            for (const doc of docs) {
                console.log('[Poll]   - Publishing: ' + doc.pollId + ' (was scheduled for ' + doc.scheduledAt.toISOString() + ')');

                let poll = polls.get(doc.pollId);
                if (!poll) {
                    poll = recreatePollFromDoc(doc);
                    polls.set(poll.id, poll);
                }
                if (!poll.messageId) {
                    await publishPollAsync(poll);
                }
            }
        }
    } catch (err: any) {
        console.error('[Poll] ⚠️ Periodic check error:', err?.message || err);
    }
}

// Run startup after Meteor is ready
Meteor.startup(() => {
    console.log('[Poll] 🚀 Starting poll system...');
    console.log('[Poll] MongoDB collection: rocketchat_scheduled_polls');

    // Initial load after 3 seconds
    Meteor.setTimeout(() => {
        console.log('[Poll] 📂 Running initial scheduled poll check...');
        void loadScheduledPollsFromDb();
    }, 3000);

    // Periodic check every 15 seconds for any missed polls
    Meteor.setInterval(() => {
        void periodicCheck();
    }, 15000);
});

// Log that system is ready
console.log('[Poll] ✅ Poll scheduling system ready');

console.log('[Poll] System initialized');
