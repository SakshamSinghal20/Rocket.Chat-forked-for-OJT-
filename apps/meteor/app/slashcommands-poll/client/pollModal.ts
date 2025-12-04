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
    toast.style.cssText = `background:${colors[type]};color:#fff;padding:12px 20px;border-radius:6px;margin-bottom:8px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);`;
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => toast.remove(), 4000);
}

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
    modal.style.cssText = 'background:#1f2329;color:#e4e7ea;width:450px;max-width:90vw;border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,0.5);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;';
    
    modal.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #2f343d;">
            <h3 style="margin:0;font-size:18px;font-weight:500;">📊 Create Poll</h3>
            <button id="poll-close-btn" style="background:none;border:none;color:#9ea2a8;font-size:24px;cursor:pointer;padding:0;">&times;</button>
        </div>
        
        <div style="padding:20px;">
            <div style="margin-bottom:16px;">
                <label style="display:block;font-size:13px;color:#9ea2a8;margin-bottom:6px;">Question</label>
                <input id="poll-question" type="text" placeholder="Ask something..." style="width:100%;padding:10px 12px;background:#2f343d;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;box-sizing:border-box;">
            </div>
            
            <div style="margin-bottom:16px;">
                <label style="display:block;font-size:13px;color:#9ea2a8;margin-bottom:6px;">Options</label>
                <div id="poll-options">
                    <input type="text" class="poll-option" placeholder="Option A" style="width:100%;padding:10px 12px;background:#2f343d;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;margin-bottom:8px;box-sizing:border-box;">
                    <input type="text" class="poll-option" placeholder="Option B" style="width:100%;padding:10px 12px;background:#2f343d;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;margin-bottom:8px;box-sizing:border-box;">
                </div>
                <button id="add-option-btn" style="background:transparent;border:1px dashed #414852;color:#9ea2a8;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:13px;width:100%;">+ Add Option</button>
            </div>
            
            <div style="display:flex;gap:20px;margin-bottom:20px;padding:12px;background:#2f343d;border-radius:4px;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
                    <input type="checkbox" id="allow-multiple" style="width:16px;height:16px;accent-color:#1d74f5;">
                    Multiple choice
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
                    <input type="checkbox" id="is-anonymous" style="width:16px;height:16px;accent-color:#1d74f5;">
                    Anonymous
                </label>
            </div>
        </div>
        
        <div style="display:flex;justify-content:flex-end;gap:12px;padding:16px 20px;border-top:1px solid #2f343d;">
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
    
    // Add option
    document.getElementById('add-option-btn')!.onclick = () => {
        const optionsDiv = document.getElementById('poll-options')!;
        const count = optionsDiv.querySelectorAll('.poll-option').length;
        if (count >= 6) {
            notify('Maximum 6 options', 'info');
            return;
        }
        
        const letter = String.fromCharCode(65 + count);
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'poll-option';
        input.placeholder = `Option ${letter}`;
        input.style.cssText = 'width:100%;padding:10px 12px;background:#2f343d;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;margin-bottom:8px;box-sizing:border-box;';
        optionsDiv.appendChild(input);
        input.focus();
    };
    
    // Create poll
    document.getElementById('poll-create-btn')!.onclick = async () => {
        const question = (document.getElementById('poll-question') as HTMLInputElement).value.trim();
        const optionInputs = document.querySelectorAll('.poll-option') as NodeListOf<HTMLInputElement>;
        const options = Array.from(optionInputs).map(i => i.value.trim()).filter(Boolean);
        const allowMultiple = (document.getElementById('allow-multiple') as HTMLInputElement).checked;
        const isAnonymous = (document.getElementById('is-anonymous') as HTMLInputElement).checked;
        
        if (!question) {
            notify('Please enter a question', 'error');
            return;
        }
        if (options.length < 2) {
            notify('Please add at least 2 options', 'error');
            return;
        }
        
        const btn = document.getElementById('poll-create-btn') as HTMLButtonElement;
        btn.disabled = true;
        btn.textContent = 'Creating...';
        
        try {
            // @ts-ignore
            await Meteor.callAsync('poll.create', {
                question,
                options,
                roomId,
                allowMultiple,
                isAnonymous
            });
            
            container.remove();
            notify('Poll created!', 'success');
        } catch (err: any) {
            notify(err?.reason || 'Failed to create poll', 'error');
            btn.disabled = false;
            btn.textContent = 'Create Poll';
        }
    };
    
    // Keyboard shortcuts
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            container.remove();
            document.removeEventListener('keydown', escHandler);
        }
    });
}

// Vote click interceptor - prevents loading state
document.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const button = target.closest('button[data-action-id]') as HTMLButtonElement;
    
    if (!button) return;
    
    const actionId = button.getAttribute('data-action-id') || '';
    const value = button.getAttribute('data-value') || '';
    
    // Check if it's a vote action
    if (actionId.startsWith('vote_') && value.includes('|')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        const [pollId, optionId] = value.split('|');
        
        try {
            // @ts-ignore
            await Meteor.callAsync('poll.vote', pollId, optionId);
        } catch (err: any) {
            notify(err?.reason || 'Vote failed', 'error');
        }
        return;
    }
    
    // Check if it's a close action
    if (actionId.startsWith('close_')) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        const pollId = value;
        
        if (!confirm('Close this poll and publish results?')) return;
        
        try {
            // @ts-ignore
            await Meteor.callAsync('poll.close', pollId);
            notify('Poll closed! Results published.', 'success');
        } catch (err: any) {
            notify(err?.reason || 'Failed to close poll', 'error');
        }
    }
}, true);

// Export
export async function openPollModal(): Promise<void> {
    await showPollModal();
}

export const PollModal = {
    open: showPollModal,
    openPollModal: showPollModal
};

// Global access
if (typeof window !== 'undefined') {
    (window as any).PollModal = PollModal;
    (window as any).openPollModal = showPollModal;
}
