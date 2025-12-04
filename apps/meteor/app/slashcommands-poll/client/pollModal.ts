// Poll Modal and Vote Handler
// @ts-ignore
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

// Toast notification
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info') {
    const container = document.getElementById('poll-toast-container') || (() => {
        const div = document.createElement('div');
        div.id = 'poll-toast-container';
        div.style.cssText = 'position:fixed;top:20px;right:20px;z-index:999999;';
        document.body.appendChild(div);
        return div;
    })();
    
    const colors: Record<string, string> = { success: '#22c55e', error: '#ef4444', info: '#3b82f6' };
    const toast = document.createElement('div');
    toast.style.cssText = 'background:' + colors[type] + ';color:#fff;padding:12px 20px;border-radius:8px;margin-bottom:8px;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ============================================================================
// INTERCEPT POLL BUTTON CLICKS
// ============================================================================

// Use MutationObserver to watch for poll buttons and attach handlers
function setupPollButtonInterceptor() {
    // Intercept ALL clicks on the document in capture phase
    document.addEventListener('click', async (event) => {
        const target = event.target as HTMLElement;
        
        // Find the button element (might be the target or a parent)
        const button = target.closest('button');
        if (!button) return;
        
        // Check for poll-related action
        // Look for any attribute that might contain our poll action ID
        const allAttrs = Array.from(button.attributes);
        let actionValue = '';
        
        for (const attr of allAttrs) {
            if (attr.value && attr.value.startsWith('pollvote_')) {
                actionValue = attr.value;
                break;
            }
            if (attr.value && attr.value.startsWith('pollclose_')) {
                actionValue = attr.value;
                break;
            }
        }
        
        // Also check button text content for our specific buttons
        const buttonText = button.textContent || '';
        
        // Check data attributes that Rocket.Chat might use
        const dataAction = button.getAttribute('data-action-id') || 
                          button.getAttribute('data-actionid') ||
                          button.getAttribute('value') || '';
        
        if (dataAction.startsWith('pollvote_') || dataAction.startsWith('pollclose_')) {
            actionValue = dataAction;
        }
        
        if (!actionValue && !actionValue.startsWith('poll')) {
            // Not a poll button
            return;
        }
        
        // Stop the event from propagating to Rocket.Chat's handler
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        
        // Handle vote action
        if (actionValue.startsWith('pollvote_')) {
            const parts = actionValue.split('_');
            if (parts.length >= 3) {
                const pollId = parts[1];
                const optionId = parts[2];
                
                try {
                    // @ts-ignore
                    await Meteor.callAsync('poll.vote', pollId, optionId);
                    showToast('Vote recorded!', 'success');
                } catch (err: any) {
                    showToast(err?.reason || 'Vote failed', 'error');
                }
            }
            return;
        }
        
        // Handle close action
        if (actionValue.startsWith('pollclose_')) {
            const pollId = actionValue.replace('pollclose_', '');
            
            if (!confirm('Close this poll? This cannot be undone.')) {
                return;
            }
            
            try {
                // @ts-ignore
                await Meteor.callAsync('poll.close', pollId);
                showToast('Poll closed!', 'success');
            } catch (err: any) {
                showToast(err?.reason || 'Failed to close', 'error');
            }
        }
    }, true); // true = capture phase (runs before other handlers)
    
    console.log('[Poll] Button interceptor installed');
}

// Install interceptor when module loads
if (typeof window !== 'undefined') {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupPollButtonInterceptor);
    } else {
        setupPollButtonInterceptor();
    }
}

// ============================================================================
// POLL CREATION MODAL
// ============================================================================

export function showPollModal() {
    const existing = document.getElementById('poll-modal-container');
    if (existing) existing.remove();
    
    const roomId = getCurrentRoomId();
    if (!roomId) {
        showToast('Please open a channel first', 'error');
        return;
    }
    
    const container = document.createElement('div');
    container.id = 'poll-modal-container';
    container.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:99999;';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background:#1f2329;color:#e4e7ea;width:450px;max-width:90vw;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.5);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;';
    
    modal.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #2f343d;"><h3 style="margin:0;font-size:18px;font-weight:500;">📊 Create Poll</h3><button id="poll-close-btn" style="background:none;border:none;color:#9ea2a8;font-size:24px;cursor:pointer;padding:0;">&times;</button></div><div style="padding:20px;"><div style="margin-bottom:16px;"><label style="display:block;font-size:13px;color:#9ea2a8;margin-bottom:6px;">Question</label><input id="poll-question" type="text" placeholder="What do you want to ask?" style="width:100%;padding:10px 12px;background:#2f343d;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;box-sizing:border-box;"></div><div style="margin-bottom:16px;"><label style="display:block;font-size:13px;color:#9ea2a8;margin-bottom:6px;">Options (min 2)</label><div id="poll-options"><input type="text" class="poll-option" placeholder="Option A" style="width:100%;padding:10px 12px;background:#2f343d;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;margin-bottom:8px;box-sizing:border-box;"><input type="text" class="poll-option" placeholder="Option B" style="width:100%;padding:10px 12px;background:#2f343d;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;margin-bottom:8px;box-sizing:border-box;"></div><button id="add-option-btn" style="background:transparent;border:1px dashed #414852;color:#9ea2a8;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:13px;width:100%;">+ Add Option</button></div><div style="display:flex;gap:16px;margin-bottom:16px;padding:12px;background:#2f343d;border-radius:4px;"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;"><input type="checkbox" id="allow-multiple" style="width:16px;height:16px;">Multiple choice</label><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;"><input type="checkbox" id="is-anonymous" style="width:16px;height:16px;">Anonymous</label></div></div><div style="display:flex;justify-content:flex-end;gap:12px;padding:16px 20px;border-top:1px solid #2f343d;"><button id="poll-cancel-btn" style="background:#2f343d;border:none;color:#e4e7ea;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:14px;">Cancel</button><button id="poll-create-btn" style="background:#1d74f5;border:none;color:#fff;padding:10px 20px;border-radius:4px;cursor:pointer;font-size:14px;font-weight:500;">Create Poll</button></div>';
    
    container.appendChild(modal);
    document.body.appendChild(container);
    
    setTimeout(() => {
        (document.getElementById('poll-question') as HTMLInputElement)?.focus();
    }, 100);
    
    container.onclick = (e) => { if (e.target === container) container.remove(); };
    document.getElementById('poll-close-btn')!.onclick = () => container.remove();
    document.getElementById('poll-cancel-btn')!.onclick = () => container.remove();
    
    document.getElementById('add-option-btn')!.onclick = () => {
        const optionsDiv = document.getElementById('poll-options')!;
        const count = optionsDiv.querySelectorAll('.poll-option').length;
        if (count >= 6) { showToast('Maximum 6 options', 'info'); return; }
        
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'poll-option';
        input.placeholder = 'Option ' + String.fromCharCode(65 + count);
        input.style.cssText = 'width:100%;padding:10px 12px;background:#2f343d;border:1px solid #414852;border-radius:4px;color:#e4e7ea;font-size:14px;margin-bottom:8px;box-sizing:border-box;';
        optionsDiv.appendChild(input);
        input.focus();
    };
    
    document.getElementById('poll-create-btn')!.onclick = async () => {
        const question = (document.getElementById('poll-question') as HTMLInputElement).value.trim();
        const optionInputs = document.querySelectorAll('.poll-option') as NodeListOf<HTMLInputElement>;
        const options = Array.from(optionInputs).map(i => i.value.trim()).filter(Boolean);
        const allowMultiple = (document.getElementById('allow-multiple') as HTMLInputElement).checked;
        const isAnonymous = (document.getElementById('is-anonymous') as HTMLInputElement).checked;
        
        if (!question) { showToast('Enter a question', 'error'); return; }
        if (options.length < 2) { showToast('Add at least 2 options', 'error'); return; }
        
        const btn = document.getElementById('poll-create-btn') as HTMLButtonElement;
        btn.disabled = true;
        btn.textContent = 'Creating...';
        
        try {
            // @ts-ignore
            await Meteor.callAsync('poll.create', { question, options, roomId, allowMultiple, isAnonymous });
            container.remove();
            showToast('Poll created!', 'success');
        } catch (err: any) {
            showToast(err?.reason || 'Failed', 'error');
            btn.disabled = false;
            btn.textContent = 'Create Poll';
        }
    };
    
    const escHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { container.remove(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
}

// Exports
export async function openPollModal(): Promise<void> { showPollModal(); }
export const PollModal = { open: showPollModal, openPollModal: showPollModal, showPollModal };

if (typeof window !== 'undefined') {
    (window as any).PollModal = PollModal;
    (window as any).openPollModal = showPollModal;
    (window as any).showPollModal = showPollModal;
}
