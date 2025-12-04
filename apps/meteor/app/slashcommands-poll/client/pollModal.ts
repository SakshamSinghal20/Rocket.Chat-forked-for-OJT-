// Poll System - Client Side
// @ts-ignore
import { Meteor } from 'meteor/meteor';
import { RoomManager } from '../../../client/lib/RoomManager';

// ============================================================================
// Helpers
// ============================================================================

function getCurrentRoomId(): string | null {
    try {
        // @ts-ignore
        const opened = RoomManager.opened;
        if (opened && typeof opened === 'string') return opened;
        
        const path = window.location.pathname;
        const parts = path.split('/');
        
        for (const segment of ['channel', 'group', 'direct', 'room']) {
            const idx = parts.indexOf(segment);
            if (idx !== -1 && parts[idx + 1]) {
                return parts[idx + 1];
            }
        }
        return parts.pop() || null;
    } catch {
        return window.location.pathname.split('/').pop() || null;
    }
}

function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
    const container = document.getElementById('poll-toast') || (() => {
        const div = document.createElement('div');
        div.id = 'poll-toast';
        div.style.cssText = 'position:fixed;top:20px;right:20px;z-index:999999;';
        document.body.appendChild(div);
        return div;
    })();
    
    const colors: Record<string, string> = { 
        success: '#22c55e', 
        error: '#ef4444', 
        info: '#3b82f6' 
    };
    
    const toast = document.createElement('div');
    toast.style.cssText = 'background:' + colors[type] + ';color:#fff;padding:12px 20px;border-radius:8px;margin-bottom:8px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:all 0.3s ease;';
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================================================
// View Voters Modal
// ============================================================================

function showVotersModal(data: { question: string; isAnonymous: boolean; options: { text: string; votes: number; voters: string[] }[] }) {
    // Remove existing modal if any
    const existing = document.getElementById('voters-modal-overlay');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.id = 'voters-modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;';
    
    let optionsHtml = '';
    data.options.forEach((opt) => {
        const votersList = data.isAnonymous 
            ? '<span style="color:#9ca3af;font-style:italic;">Anonymous voting - names hidden</span>'
            : (opt.voters.length > 0 
                ? opt.voters.map(v => '<span style="background:#374151;padding:4px 10px;border-radius:12px;margin:3px;display:inline-block;font-size:13px;">' + v + '</span>').join('')
                : '<span style="color:#6b7280;font-style:italic;">No votes yet</span>');
        
        optionsHtml += '<div style="margin-bottom:16px;padding:12px;background:#1f2937;border-radius:8px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
            '<span style="font-weight:600;color:#e5e7eb;">' + opt.text + '</span>' +
            '<span style="background:#3b82f6;color:#fff;padding:4px 12px;border-radius:12px;font-size:13px;">' + opt.votes + ' vote' + (opt.votes !== 1 ? 's' : '') + '</span>' +
            '</div>' +
            '<div style="color:#d1d5db;">' + votersList + '</div>' +
            '</div>';
    });
    
    overlay.innerHTML = '<div style="background:#111827;border-radius:12px;width:90%;max-width:500px;max-height:80vh;overflow:auto;box-shadow:0 25px 50px rgba(0,0,0,0.5);">' +
        '<div style="padding:20px;border-bottom:1px solid #374151;display:flex;justify-content:space-between;align-items:center;">' +
        '<h3 style="margin:0;color:#f3f4f6;font-size:18px;">👥 Poll Voters</h3>' +
        '<button id="voters-modal-close" style="background:none;border:none;color:#9ca3af;font-size:24px;cursor:pointer;padding:0;line-height:1;">&times;</button>' +
        '</div>' +
        '<div style="padding:20px;">' +
        '<div style="color:#9ca3af;margin-bottom:16px;font-size:14px;">' + data.question + '</div>' +
        optionsHtml +
        '</div>' +
        '</div>';
    
    document.body.appendChild(overlay);
    
    // Close handlers
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
    document.getElementById('voters-modal-close')?.addEventListener('click', () => overlay.remove());
}

// ============================================================================
// Button Click Interceptor
// ============================================================================

function setupButtonInterceptor() {
    document.addEventListener('click', async (event) => {
        const target = event.target as HTMLElement;
        const button = target.closest('button');
        if (!button) return;
        
        // Look for poll action in any attribute
        let actionValue = '';
        for (const attr of Array.from(button.attributes)) {
            const val = attr.value || '';
            if (val.startsWith('pollvote_') || val.startsWith('pollclose_') || val.startsWith('pollexport_') || val.startsWith('pollviewers_')) {
                actionValue = val;
                break;
            }
        }
        
        if (!actionValue) return;
        
        // Prevent default Rocket.Chat handling
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        
        // Handle vote
        if (actionValue.startsWith('pollvote_')) {
            const parts = actionValue.split('_');
            if (parts.length >= 3) {
                const pollId = parts[1];
                const optionId = parts[2];
                
                try {
                    // @ts-ignore
                    const result = await Meteor.callAsync('poll.vote', pollId, optionId);
                    if (result.voted) {
                        showToast('Voted for: ' + result.option, 'success');
                    } else {
                        showToast('Vote removed', 'info');
                    }
                } catch (err: any) {
                    showToast(err?.reason || 'Vote failed', 'error');
                }
            }
            return;
        }
        
        // Handle close
        if (actionValue.startsWith('pollclose_')) {
            const pollId = actionValue.replace('pollclose_', '');
            
            // Check permission first
            try {
                // @ts-ignore
                const canClose = await Meteor.callAsync('poll.canClose', pollId);
                if (!canClose) {
                    showToast('Only poll creator or admin can close', 'error');
                    return;
                }
            } catch {
                // Continue anyway, server will validate
            }
            
            if (!confirm('Close this poll? Voting will be locked.')) return;
            
            try {
                // @ts-ignore
                await Meteor.callAsync('poll.close', pollId);
                showToast('Poll closed!', 'success');
            } catch (err: any) {
                showToast(err?.reason || 'Failed to close', 'error');
            }
            return;
        }
        
        // Handle export (pollexport_POLLID_pie or pollexport_POLLID_bar)
        if (actionValue.startsWith('pollexport_')) {
            const parts = actionValue.replace('pollexport_', '').split('_');
            const pollId = parts[0];
            const chartType = parts[1] === 'bar' ? 'bar' : 'pie';
            
            try {
                // @ts-ignore
                await Meteor.callAsync('poll.export', pollId, chartType);
                showToast(chartType === 'bar' ? 'Bar graph exported!' : 'Pie chart exported!', 'success');
            } catch (err: any) {
                showToast(err?.reason || 'Export failed', 'error');
            }
            return;
        }
        
        // Handle View Voters
        if (actionValue.startsWith('pollviewers_')) {
            const pollId = actionValue.replace('pollviewers_', '');
            
            try {
                // @ts-ignore
                const result = await Meteor.callAsync('poll.getVoters', pollId);
                showVotersModal(result);
            } catch (err: any) {
                showToast(err?.reason || 'Failed to load voters', 'error');
            }
        }
    }, true);
    
    console.log('[Poll] Button interceptor ready');
}

// Initialize interceptor
if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupButtonInterceptor);
    } else {
        setupButtonInterceptor();
    }
}

// ============================================================================
// Poll Creation Modal
// ============================================================================

export function showPollModal() {
    const existing = document.getElementById('poll-modal-overlay');
    if (existing) existing.remove();
    
    const roomId = getCurrentRoomId();
    if (!roomId) {
        showToast('Open a channel first', 'error');
        return;
    }
    
    // Create modal
    const overlay = document.createElement('div');
    overlay.id = 'poll-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:99999;';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background:#1f2329;color:#e4e7ea;width:500px;max-width:95vw;max-height:90vh;overflow-y:auto;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.5);';
    
    modal.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #2f343d;position:sticky;top:0;background:#1f2329;">
            <h3 style="margin:0;font-size:18px;">📊 Create Poll</h3>
            <button id="poll-modal-close" style="background:none;border:none;color:#9ea2a8;font-size:24px;cursor:pointer;">&times;</button>
        </div>
        
        <div style="padding:20px;">
            <div style="margin-bottom:16px;">
                <label style="display:block;font-size:13px;color:#9ea2a8;margin-bottom:6px;">Question *</label>
                <input id="poll-question" type="text" placeholder="What do you want to ask?" 
                    style="width:100%;padding:12px;background:#2f343d;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;box-sizing:border-box;">
            </div>
            
            <div style="margin-bottom:16px;">
                <label style="display:block;font-size:13px;color:#9ea2a8;margin-bottom:6px;">Options * (min 2, max 6)</label>
                <div id="poll-options-container">
                    <div class="poll-option-row" style="display:flex;gap:8px;margin-bottom:8px;">
                        <span style="color:#f87171;font-weight:bold;width:24px;line-height:42px;">A</span>
                        <input type="text" class="poll-option-input" placeholder="First option" 
                            style="flex:1;padding:12px;background:#2f343d;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;">
                    </div>
                    <div class="poll-option-row" style="display:flex;gap:8px;margin-bottom:8px;">
                        <span style="color:#60a5fa;font-weight:bold;width:24px;line-height:42px;">B</span>
                        <input type="text" class="poll-option-input" placeholder="Second option" 
                            style="flex:1;padding:12px;background:#2f343d;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;">
                    </div>
                </div>
                <button id="poll-add-option" style="width:100%;padding:10px;background:transparent;border:1px dashed #414852;color:#9ea2a8;border-radius:4px;cursor:pointer;font-size:13px;">
                    + Add Option
                </button>
            </div>
            
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
                <label style="display:flex;align-items:center;gap:8px;padding:12px;background:#2f343d;border-radius:4px;cursor:pointer;">
                    <input type="checkbox" id="poll-multiple" style="width:18px;height:18px;">
                    <span style="font-size:13px;">Multiple choice</span>
                </label>
                <label style="display:flex;align-items:center;gap:8px;padding:12px;background:#2f343d;border-radius:4px;cursor:pointer;">
                    <input type="checkbox" id="poll-anonymous" style="width:18px;height:18px;">
                    <span style="font-size:13px;">Anonymous voting</span>
                </label>
            </div>
            
            <div style="margin-bottom:16px;padding:12px;background:#2f343d;border-radius:4px;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px;">
                    <input type="checkbox" id="poll-schedule-toggle" style="width:18px;height:18px;">
                    <span style="font-size:13px;">Schedule for later</span>
                </label>
                <div id="poll-schedule-container" style="display:none;margin-top:8px;">
                    <input type="datetime-local" id="poll-schedule-time" 
                        style="width:100%;padding:10px;background:#1f2329;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;">
                    <p style="margin:4px 0 0;font-size:11px;color:#6b7280;">Poll will auto-publish at this time</p>
                </div>
            </div>
        </div>
        
        <div style="display:flex;justify-content:flex-end;gap:12px;padding:16px 20px;border-top:1px solid #2f343d;position:sticky;bottom:0;background:#1f2329;">
            <button id="poll-cancel" style="padding:10px 20px;background:#2f343d;border:none;color:#e4e7ea;border-radius:4px;cursor:pointer;font-size:14px;">Cancel</button>
            <button id="poll-create" style="padding:10px 20px;background:#1d74f5;border:none;color:#fff;border-radius:4px;cursor:pointer;font-size:14px;font-weight:500;">Create Poll</button>
        </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Set min datetime to now
    const scheduleInput = document.getElementById('poll-schedule-time') as HTMLInputElement;
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset() + 5);
    scheduleInput.min = now.toISOString().slice(0, 16);
    scheduleInput.value = now.toISOString().slice(0, 16);
    
    // Focus question
    setTimeout(() => (document.getElementById('poll-question') as HTMLInputElement)?.focus(), 100);
    
    // Close handlers
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.getElementById('poll-modal-close')!.onclick = () => overlay.remove();
    document.getElementById('poll-cancel')!.onclick = () => overlay.remove();
    
    // Schedule toggle
    document.getElementById('poll-schedule-toggle')!.onchange = (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        document.getElementById('poll-schedule-container')!.style.display = checked ? 'block' : 'none';
    };
    
    // Add option
    const optionColors = ['#f87171', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#fb7185'];
    document.getElementById('poll-add-option')!.onclick = () => {
        const container = document.getElementById('poll-options-container')!;
        const count = container.querySelectorAll('.poll-option-row').length;
        
        if (count >= 6) {
            showToast('Maximum 6 options', 'info');
            return;
        }
        
        const letter = String.fromCharCode(65 + count);
        const row = document.createElement('div');
        row.className = 'poll-option-row';
        row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center;';
        row.innerHTML = `
            <span style="color:${optionColors[count]};font-weight:bold;width:24px;line-height:42px;">${letter}</span>
            <input type="text" class="poll-option-input" placeholder="Option ${letter}" 
                style="flex:1;padding:12px;background:#2f343d;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;">
            <button class="poll-remove-option" style="background:none;border:none;color:#ef4444;font-size:20px;cursor:pointer;padding:8px;">×</button>
        `;
        
        row.querySelector('.poll-remove-option')!.addEventListener('click', () => {
            row.remove();
            updateOptionLabels();
        });
        
        container.appendChild(row);
        (row.querySelector('.poll-option-input') as HTMLInputElement).focus();
    };
    
    function updateOptionLabels() {
        const rows = document.querySelectorAll('.poll-option-row');
        rows.forEach((row, i) => {
            const label = row.querySelector('span');
            if (label) {
                label.textContent = String.fromCharCode(65 + i);
                label.style.color = optionColors[i];
            }
        });
    }
    
    // Create poll
    document.getElementById('poll-create')!.onclick = async () => {
        const question = (document.getElementById('poll-question') as HTMLInputElement).value.trim();
        const optionInputs = document.querySelectorAll('.poll-option-input') as NodeListOf<HTMLInputElement>;
        const options = Array.from(optionInputs).map(i => i.value.trim()).filter(Boolean);
        const allowMultiple = (document.getElementById('poll-multiple') as HTMLInputElement).checked;
        const isAnonymous = (document.getElementById('poll-anonymous') as HTMLInputElement).checked;
        const scheduleEnabled = (document.getElementById('poll-schedule-toggle') as HTMLInputElement).checked;
        const scheduledAt = scheduleEnabled ? (document.getElementById('poll-schedule-time') as HTMLInputElement).value : null;
        
        if (!question) {
            showToast('Enter a question', 'error');
            return;
        }
        if (options.length < 2) {
            showToast('Add at least 2 options', 'error');
            return;
        }
        if (scheduleEnabled && scheduledAt && new Date(scheduledAt) <= new Date()) {
            showToast('Schedule time must be in the future', 'error');
            return;
        }
        
        const btn = document.getElementById('poll-create') as HTMLButtonElement;
        btn.disabled = true;
        btn.textContent = 'Creating...';
        
        try {
            // @ts-ignore
            const result = await Meteor.callAsync('poll.create', {
                question,
                options,
                roomId,
                allowMultiple,
                isAnonymous,
                scheduledAt: scheduledAt || undefined
            });
            
            overlay.remove();
            
            if (result.scheduled) {
                showToast('Poll scheduled for ' + new Date(result.scheduledFor).toLocaleString(), 'success');
            } else {
                showToast('Poll created!', 'success');
            }
        } catch (err: any) {
            showToast(err?.reason || 'Failed to create poll', 'error');
            btn.disabled = false;
            btn.textContent = 'Create Poll';
        }
    };
    
    // Escape to close
    const escHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

// ============================================================================
// Exports
// ============================================================================

export async function openPollModal(): Promise<void> {
    showPollModal();
}

export const PollModal = {
    open: showPollModal,
    openPollModal: showPollModal,
    showPollModal: showPollModal
};

if (typeof window !== 'undefined') {
    (window as any).PollModal = PollModal;
    (window as any).openPollModal = showPollModal;
    (window as any).showPollModal = showPollModal;
}
