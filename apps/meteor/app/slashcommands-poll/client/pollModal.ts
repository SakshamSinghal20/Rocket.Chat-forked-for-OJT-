// Poll Modal - Rocket.Chat Native Theme
// @ts-ignore - Meteor package import
import { Meteor } from 'meteor/meteor';
import { RoomManager } from '../../../client/lib/RoomManager';

// Get current room
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

// Notification helper
function notify(message: string, type: 'success' | 'error' | 'info' = 'info') {
    const container = document.getElementById('poll-notify') || (() => {
        const div = document.createElement('div');
        div.id = 'poll-notify';
        div.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999';
        document.body.appendChild(div);
        return div;
    })();
    
    const colors: Record<string, string> = {
        success: '#16a34a',
        error: '#dc2626',
        info: '#2563eb'
    };
    
    const toast = document.createElement('div');
    toast.style.cssText = `background:${colors[type]};color:#fff;padding:12px 20px;border-radius:6px;margin-bottom:8px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:slideIn 0.3s ease;`;
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);

// Create poll modal
async function showPollModal() {
    const existing = document.getElementById('poll-modal-container');
    if (existing) existing.remove();
    
    const roomId = getCurrentRoomId();
    if (!roomId) {
        notify('Please open a channel first', 'error');
        return;
    }
    
    // Modal container
    const container = document.createElement('div');
    container.id = 'poll-modal-container';
    container.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:99999;';
    
    // Modal box - Rocket.Chat dark theme
    const modal = document.createElement('div');
    modal.style.cssText = 'background:#1f2329;color:#e4e7ea;width:480px;max-width:90vw;max-height:90vh;overflow-y:auto;border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,0.5);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;';
    
    modal.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #2f343d;position:sticky;top:0;background:#1f2329;z-index:1;">
            <h3 style="margin:0;font-size:18px;font-weight:500;">📊 Create Poll</h3>
            <button id="poll-close-btn" style="background:none;border:none;color:#9ea2a8;font-size:24px;cursor:pointer;padding:0;line-height:1;">&times;</button>
        </div>
        
        <div style="padding:20px;">
            <!-- Question -->
            <div style="margin-bottom:16px;">
                <label style="display:block;font-size:13px;color:#9ea2a8;margin-bottom:6px;">Question *</label>
                <input id="poll-question" type="text" placeholder="What do you want to ask?" style="width:100%;padding:10px 12px;background:#2f343d;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;box-sizing:border-box;">
            </div>
            
            <!-- Options -->
            <div style="margin-bottom:16px;">
                <label style="display:block;font-size:13px;color:#9ea2a8;margin-bottom:6px;">Options * (min 2)</label>
                <div id="poll-options">
                    <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
                        <span style="color:#f87171;font-weight:bold;width:20px;">A</span>
                        <input type="text" class="poll-option" placeholder="First option" style="flex:1;padding:10px 12px;background:#2f343d;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;box-sizing:border-box;">
                    </div>
                    <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
                        <span style="color:#60a5fa;font-weight:bold;width:20px;">B</span>
                        <input type="text" class="poll-option" placeholder="Second option" style="flex:1;padding:10px 12px;background:#2f343d;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;box-sizing:border-box;">
                    </div>
                </div>
                <button id="add-option-btn" style="background:transparent;border:1px dashed #414852;color:#9ea2a8;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:13px;width:100%;margin-top:4px;">+ Add Option (max 6)</button>
            </div>
            
            <!-- Settings -->
            <div style="margin-bottom:16px;padding:12px;background:#2f343d;border-radius:4px;">
                <label style="display:block;font-size:13px;color:#9ea2a8;margin-bottom:8px;">Poll Settings</label>
                <div style="display:flex;flex-wrap:wrap;gap:16px;">
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
                        <input type="checkbox" id="allow-multiple" style="width:16px;height:16px;accent-color:#1d74f5;">
                        Multiple choice
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
                        <input type="checkbox" id="is-anonymous" style="width:16px;height:16px;accent-color:#1d74f5;">
                        Anonymous voting
                    </label>
                </div>
            </div>
            
            <!-- Schedule -->
            <div style="margin-bottom:16px;padding:12px;background:#2f343d;border-radius:4px;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;margin-bottom:8px;">
                    <input type="checkbox" id="enable-schedule" style="width:16px;height:16px;accent-color:#1d74f5;">
                    Schedule for later
                </label>
                <div id="schedule-options" style="display:none;margin-top:8px;">
                    <input type="datetime-local" id="schedule-time" style="width:100%;padding:10px 12px;background:#1f2329;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;box-sizing:border-box;">
                    <p style="margin:4px 0 0;font-size:11px;color:#9ea2a8;">Poll will be published at this time</p>
                </div>
            </div>
            
            <!-- Help text -->
            <div style="padding:12px;background:#1a1d21;border-radius:4px;border-left:3px solid #1d74f5;">
                <p style="margin:0 0 8px;font-size:12px;color:#9ea2a8;"><strong>How to use:</strong></p>
                <p style="margin:0;font-size:12px;color:#6b7280;">
                    • Vote: <code style="background:#2f343d;padding:2px 6px;border-radius:3px;">/poll-vote poll_id A</code><br>
                    • Close (admin): <code style="background:#2f343d;padding:2px 6px;border-radius:3px;">/poll-close poll_id</code><br>
                    • Export results: <code style="background:#2f343d;padding:2px 6px;border-radius:3px;">/poll-export poll_id</code>
                </p>
            </div>
        </div>
        
        <div style="display:flex;justify-content:flex-end;gap:12px;padding:16px 20px;border-top:1px solid #2f343d;position:sticky;bottom:0;background:#1f2329;">
            <button id="poll-cancel-btn" style="background:#2f343d;border:none;color:#e4e7ea;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:14px;">Cancel</button>
            <button id="poll-create-btn" style="background:#1d74f5;border:none;color:#fff;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:14px;font-weight:500;">Create Poll</button>
        </div>
    `;
    
    container.appendChild(modal);
    document.body.appendChild(container);
    
    // Focus question input
    setTimeout(() => {
        const questionInput = document.getElementById('poll-question') as HTMLInputElement;
        questionInput?.focus();
    }, 100);
    
    // Event handlers
    container.onclick = (e) => {
        if (e.target === container) container.remove();
    };
    
    document.getElementById('poll-close-btn')!.onclick = () => container.remove();
    document.getElementById('poll-cancel-btn')!.onclick = () => container.remove();
    
    // Schedule toggle
    const scheduleCheckbox = document.getElementById('enable-schedule') as HTMLInputElement;
    const scheduleOptions = document.getElementById('schedule-options') as HTMLDivElement;
    const scheduleTime = document.getElementById('schedule-time') as HTMLInputElement;
    
    // Set minimum date to now
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    scheduleTime.min = now.toISOString().slice(0, 16);
    
    scheduleCheckbox.onchange = () => {
        scheduleOptions.style.display = scheduleCheckbox.checked ? 'block' : 'none';
    };
    
    // Add option
    const optionColors = ['#f87171', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#fb7185'];
    document.getElementById('add-option-btn')!.onclick = () => {
        const optionsDiv = document.getElementById('poll-options')!;
        const count = optionsDiv.querySelectorAll('.poll-option').length;
        if (count >= 6) {
            notify('Maximum 6 options allowed', 'info');
            return;
        }
        
        const letter = String.fromCharCode(65 + count);
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center;';
        wrapper.innerHTML = `
            <span style="color:${optionColors[count]};font-weight:bold;width:20px;">${letter}</span>
            <input type="text" class="poll-option" placeholder="Option ${letter}" style="flex:1;padding:10px 12px;background:#2f343d;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;box-sizing:border-box;">
            <button class="remove-option" style="background:none;border:none;color:#ef4444;font-size:18px;cursor:pointer;padding:4px 8px;">×</button>
        `;
        
        wrapper.querySelector('.remove-option')!.addEventListener('click', () => {
            wrapper.remove();
            updateOptionLabels();
        });
        
        optionsDiv.appendChild(wrapper);
        (wrapper.querySelector('.poll-option') as HTMLInputElement).focus();
    };
    
    // Update option labels after removal
    function updateOptionLabels() {
        const optionsDiv = document.getElementById('poll-options')!;
        const wrappers = optionsDiv.children;
        for (let i = 0; i < wrappers.length; i++) {
            const label = wrappers[i].querySelector('span');
            if (label) {
                label.textContent = String.fromCharCode(65 + i);
                label.style.color = optionColors[i];
            }
        }
    }
    
    // Create poll
    document.getElementById('poll-create-btn')!.onclick = async () => {
        const question = (document.getElementById('poll-question') as HTMLInputElement).value.trim();
        const optionInputs = document.querySelectorAll('.poll-option') as NodeListOf<HTMLInputElement>;
        const options = Array.from(optionInputs).map(i => i.value.trim()).filter(Boolean);
        const allowMultiple = (document.getElementById('allow-multiple') as HTMLInputElement).checked;
        const isAnonymous = (document.getElementById('is-anonymous') as HTMLInputElement).checked;
        const scheduleEnabled = scheduleCheckbox.checked;
        const scheduledAt = scheduleEnabled ? scheduleTime.value : null;
        
        if (!question) {
            notify('Please enter a question', 'error');
            return;
        }
        if (options.length < 2) {
            notify('Please add at least 2 options', 'error');
            return;
        }
        if (scheduleEnabled && !scheduledAt) {
            notify('Please select a schedule time', 'error');
            return;
        }
        if (scheduleEnabled && new Date(scheduledAt!) <= new Date()) {
            notify('Schedule time must be in the future', 'error');
            return;
        }
        
        const btn = document.getElementById('poll-create-btn') as HTMLButtonElement;
        btn.disabled = true;
        btn.textContent = scheduleEnabled ? 'Scheduling...' : 'Creating...';
        
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
            
            container.remove();
            
            if (result.scheduled) {
                notify(`Poll scheduled for ${new Date(result.scheduledFor).toLocaleString()}`, 'success');
            } else {
                notify('Poll created! Check the chat.', 'success');
            }
        } catch (err: any) {
            notify(err?.reason || 'Failed to create poll', 'error');
            btn.disabled = false;
            btn.textContent = 'Create Poll';
        }
    };
    
    // Keyboard shortcuts
    const escHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            container.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

// Export - showPollModal is used by usePollAction hook
export { showPollModal };

export async function openPollModal(): Promise<void> {
    await showPollModal();
}

export const PollModal = {
    open: showPollModal,
    openPollModal: showPollModal,
    showPollModal: showPollModal
};

// Global access
if (typeof window !== 'undefined') {
    (window as any).PollModal = PollModal;
    (window as any).openPollModal = showPollModal;
    (window as any).showPollModal = showPollModal;
}
