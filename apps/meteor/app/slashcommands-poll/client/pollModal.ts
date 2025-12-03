// Poll System - Client-side with smooth voting (no loading flicker)
import { Meteor } from 'meteor/meteor';

import { RoomManager } from '../../../client/lib/RoomManager';

// ============================================================================
// Initialization
// ============================================================================

Meteor.startup(() => {
    // Add poll button after UI loads
    setTimeout(initPollButton, 2000);
    setInterval(() => {
        if (!document.getElementById('rcPollBtn')) initPollButton();
    }, 3000);
    
    // Set up vote interceptor
    setupVoteHandler();
});

// ============================================================================
// Vote Handler - Prevents loading flicker
// ============================================================================

function setupVoteHandler() {
    // Intercept ALL clicks in capture phase
    document.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;
        const button = target.closest('button') as HTMLButtonElement;
        if (!button) return;
        
        // Check if this is a poll vote button
        // Look for actionId starting with "vote_" or value containing "|"
        const actionId = button.getAttribute('data-action-id') || 
                        button.dataset?.actionId || '';
        const value = button.getAttribute('data-value') || 
                     button.dataset?.value || 
                     button.getAttribute('value') || '';
        
        const isVoteButton = actionId.startsWith('vote_') || 
                            (value.includes('|') && value.split('|').length === 2);
        
        if (!isVoteButton) return;
        
        // Stop all event propagation to prevent UIKit handling
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        // Parse poll ID and option ID
        let pollId: string;
        let optionId: string;
        
        if (value.includes('|')) {
            [pollId, optionId] = value.split('|');
        } else if (actionId.startsWith('vote_')) {
            const parts = actionId.replace('vote_', '').split('_');
            pollId = parts[0];
            optionId = parts[1];
        } else {
            return;
        }
        
        // Don't show any loading state - just call the method
        // The UI will update via real-time message sync
        try {
            await Meteor.callAsync('poll.vote', pollId, optionId);
            // Success - message will update automatically via notifyOnMessageChange
        } catch (err: any) {
            console.error('[Poll] Vote failed:', err);
            showToast(err.reason || 'Vote failed', 'error');
        }
    }, true);
}

// ============================================================================
// Poll Button
// ============================================================================

function initPollButton() {
    const toolbar = document.querySelector('[data-qa="file-upload"]')?.parentElement ||
                   document.querySelector('.rc-message-box__actions') ||
                   document.querySelector('.message-box__actions');
    
    if (!toolbar || document.getElementById('rcPollBtn')) return;
    
    const btn = document.createElement('button');
    btn.id = 'rcPollBtn';
    btn.type = 'button';
    btn.title = 'Create Poll';
    btn.setAttribute('aria-label', 'Create Poll');
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
    </svg>`;
    btn.style.cssText = `
        background: none;
        border: none;
        color: var(--rcx-color-font-hint, #6c737a);
        cursor: pointer;
        padding: 8px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    
    btn.onmouseenter = () => btn.style.color = 'var(--rcx-button-primary-background-color, #156ff5)';
    btn.onmouseleave = () => btn.style.color = 'var(--rcx-color-font-hint, #6c737a)';
    btn.onclick = (e) => { e.preventDefault(); openModal(); };
    
    toolbar.appendChild(btn);
}

// ============================================================================
// Modal
// ============================================================================

export function showPollModal() { openModal(); }

function openModal() {
    closeModal();
    
    const modal = document.createElement('div');
    modal.id = 'pollModal';
    modal.innerHTML = `
        <div id="pollOverlay" style="
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.6);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
        ">
            <div style="
                background: var(--rcx-color-surface-room, #1f2329);
                padding: 24px;
                border-radius: 8px;
                color: var(--rcx-color-font-default, #e4e7ea);
                width: 400px;
                max-width: 90vw;
                box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            ">
                <h3 style="margin: 0 0 20px; font-size: 18px; display: flex; align-items: center; gap: 8px;">
                    <span>📊</span> Create Poll
                </h3>
                
                <div style="margin-bottom: 16px;">
                    <label style="display: block; font-size: 12px; color: var(--rcx-color-font-hint); margin-bottom: 4px; text-transform: uppercase;">
                        Question
                    </label>
                    <input id="pQ" type="text" placeholder="Ask something..." style="
                        width: 100%; padding: 10px 12px;
                        background: var(--rcx-color-surface-neutral, #2f343d);
                        color: inherit;
                        border: 1px solid var(--rcx-color-stroke-light, #3d4149);
                        border-radius: 6px;
                        font-size: 14px;
                        outline: none;
                        box-sizing: border-box;
                    ">
                </div>
                
                <div style="margin-bottom: 12px;">
                    <label style="display: block; font-size: 12px; color: var(--rcx-color-font-hint); margin-bottom: 4px; text-transform: uppercase;">
                        Options
                    </label>
                    <div id="pOpts"></div>
                </div>
                
                <button id="pAdd" type="button" style="
                    background: transparent;
                    color: var(--rcx-button-primary-background-color, #156ff5);
                    border: 1px dashed currentColor;
                    padding: 6px 12px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                    margin-bottom: 16px;
                ">+ Add Option</button>
                
                <label style="
                    display: flex; align-items: center; gap: 10px;
                    padding: 10px 12px;
                    background: var(--rcx-color-surface-neutral, #2f343d);
                    border-radius: 6px;
                    cursor: pointer;
                    margin-bottom: 20px;
                ">
                    <input id="pMulti" type="checkbox" style="width: 16px; height: 16px;">
                    <span style="font-size: 14px;">Allow multiple choices</span>
                </label>
                
                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button id="pCancel" type="button" style="
                        background: var(--rcx-color-surface-neutral, #2f343d);
                        color: inherit;
                        border: none;
                        padding: 10px 18px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 14px;
                    ">Cancel</button>
                    <button id="pCreate" type="button" style="
                        background: var(--rcx-button-primary-background-color, #156ff5);
                        color: white;
                        border: none;
                        padding: 10px 18px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 14px;
                        font-weight: 500;
                    ">Create</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Add initial options
    const opts = document.getElementById('pOpts')!;
    addOpt(opts, 'A');
    addOpt(opts, 'B');
    
    // Focus question
    setTimeout(() => (document.getElementById('pQ') as HTMLInputElement)?.focus(), 50);
    
    // Events
    document.getElementById('pCancel')!.onclick = closeModal;
    document.getElementById('pCreate')!.onclick = create;
    document.getElementById('pAdd')!.onclick = () => {
        const count = opts.querySelectorAll('input').length;
        if (count < 10) addOpt(opts, String.fromCharCode(65 + count));
        else showToast('Max 10 options', 'error');
    };
    document.getElementById('pollOverlay')!.onclick = (e) => {
        if (e.target === e.currentTarget) closeModal();
    };
    
    const esc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', esc); }
    };
    document.addEventListener('keydown', esc);
}

function addOpt(container: HTMLElement, letter: string) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';
    row.innerHTML = `
        <span style="color: var(--rcx-color-font-hint); font-size: 12px; min-width: 14px;">${letter}</span>
        <input class="pOptIn" type="text" placeholder="Option ${letter}" style="
            flex: 1; padding: 10px 12px;
            background: var(--rcx-color-surface-neutral, #2f343d);
            color: inherit;
            border: 1px solid var(--rcx-color-stroke-light, #3d4149);
            border-radius: 6px;
            font-size: 14px;
            outline: none;
        ">
    `;
    container.appendChild(row);
    if (container.querySelectorAll('input').length > 2) {
        row.querySelector('input')?.focus();
    }
}

function closeModal() {
    document.getElementById('pollModal')?.remove();
}

async function create() {
    const q = (document.getElementById('pQ') as HTMLInputElement)?.value.trim();
    const opts = Array.from(document.querySelectorAll('.pOptIn') as NodeListOf<HTMLInputElement>)
        .map(i => i.value.trim()).filter(Boolean);
    const multi = (document.getElementById('pMulti') as HTMLInputElement)?.checked;
    
    if (!q) { showToast('Enter a question', 'error'); return; }
    if (opts.length < 2) { showToast('Add at least 2 options', 'error'); return; }
    
    const roomId = RoomManager.opened;
    if (!roomId) { showToast('Open a room first', 'error'); return; }
    
    const btn = document.getElementById('pCreate') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Creating...';
    
    try {
        await Meteor.callAsync('poll.create', { question: q, options: opts, allowMultiple: multi, roomId });
        closeModal();
        showToast('Poll created!', 'success');
    } catch (err: any) {
        showToast(err.reason || 'Failed', 'error');
        btn.disabled = false;
        btn.textContent = 'Create';
    }
}

// ============================================================================
// Toast Notifications
// ============================================================================

function showToast(msg: string, type: 'success' | 'error') {
    document.querySelectorAll('.pToast').forEach(t => t.remove());
    
    const t = document.createElement('div');
    t.className = 'pToast';
    t.style.cssText = `
        position: fixed; top: 16px; right: 16px; z-index: 999999;
        background: ${type === 'success' ? '#2de0a5' : '#f5455c'};
        color: ${type === 'success' ? '#1a1a1a' : '#fff'};
        padding: 10px 16px;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        animation: toastIn 0.2s ease;
    `;
    t.textContent = msg;
    
    if (!document.getElementById('toastStyle')) {
        const s = document.createElement('style');
        s.id = 'toastStyle';
        s.textContent = '@keyframes toastIn { from { opacity: 0; transform: translateY(-10px); } }';
        document.head.appendChild(s);
    }
    
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}
