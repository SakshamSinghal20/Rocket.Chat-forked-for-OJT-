// Poll System - Full Featured Client with Charts, Export, Anonymous, Scheduling
import { Meteor } from 'meteor/meteor';

import { RoomManager } from '../../../client/lib/RoomManager';

// ============================================================================
// Initialization
// ============================================================================

Meteor.startup(() => {
    setTimeout(initPollButton, 2000);
    setInterval(() => {
        if (!document.getElementById('rcPollBtn')) initPollButton();
    }, 3000);
    setupVoteHandler();
});

// ============================================================================
// Vote & Action Handler
// ============================================================================

function setupVoteHandler() {
    document.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;
        const button = target.closest('button') as HTMLButtonElement;
        if (!button) return;
        
        const actionId = button.getAttribute('data-action-id') || 
                        button.dataset?.actionId || '';
        const value = button.getAttribute('data-value') || 
                     button.dataset?.value || 
                     button.getAttribute('value') || '';
        
        // Vote action
        if (actionId.startsWith('vote_') || (value.includes('|') && value.split('|').length === 2)) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            
            let pollId: string, optionId: string;
            if (value.includes('|')) {
                [pollId, optionId] = value.split('|');
            } else {
                const parts = actionId.replace('vote_', '').split('_');
                pollId = parts[0];
                optionId = parts[1];
            }
            
            try {
                await Meteor.callAsync('poll.vote', pollId, optionId);
            } catch (err: any) {
                showToast(err.reason || 'Vote failed', 'error');
            }
            return;
        }
        
        // Close action
        if (actionId.startsWith('close_')) {
            e.preventDefault();
            e.stopPropagation();
            
            const pollId = value.replace('close_', '');
            if (confirm('Are you sure you want to close this poll? This cannot be undone.')) {
                try {
                    await Meteor.callAsync('poll.close', pollId);
                    showToast('Poll closed successfully', 'success');
                } catch (err: any) {
                    showToast(err.reason || 'Failed to close poll', 'error');
                }
            }
            return;
        }
        
        // Export action
        if (actionId.startsWith('export_')) {
            e.preventDefault();
            e.stopPropagation();
            
            const pollId = value.replace('export_', '');
            showExportModal(pollId);
            return;
        }
    }, true);
}

// ============================================================================
// Export Modal
// ============================================================================

function showExportModal(pollId: string) {
    closeModal('exportModal');
    
    const modal = document.createElement('div');
    modal.id = 'exportModal';
    modal.innerHTML = `
        <div id="exportOverlay" style="
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
            ">
                <h3 style="margin: 0 0 20px; font-size: 18px;">📥 Export Poll Results</h3>
                
                <div id="exportContent" style="
                    background: var(--rcx-color-surface-neutral, #2f343d);
                    padding: 16px;
                    border-radius: 6px;
                    margin-bottom: 16px;
                    max-height: 300px;
                    overflow: auto;
                    font-family: monospace;
                    font-size: 12px;
                    white-space: pre-wrap;
                ">Loading...</div>
                
                <div style="display: flex; gap: 10px; margin-bottom: 16px;">
                    <button id="exportCSV" style="
                        flex: 1;
                        background: var(--rcx-color-surface-neutral, #2f343d);
                        color: inherit;
                        border: 1px solid var(--rcx-color-stroke-light, #3d4149);
                        padding: 10px;
                        border-radius: 6px;
                        cursor: pointer;
                    ">📄 CSV</button>
                    <button id="exportJSON" style="
                        flex: 1;
                        background: var(--rcx-button-primary-background-color, #156ff5);
                        color: white;
                        border: none;
                        padding: 10px;
                        border-radius: 6px;
                        cursor: pointer;
                    ">📋 JSON</button>
                </div>
                
                <div style="display: flex; gap: 10px;">
                    <button id="copyExport" style="
                        flex: 1;
                        background: #27ae60;
                        color: white;
                        border: none;
                        padding: 10px;
                        border-radius: 6px;
                        cursor: pointer;
                    ">📋 Copy to Clipboard</button>
                    <button id="closeExport" style="
                        flex: 1;
                        background: var(--rcx-color-surface-neutral, #2f343d);
                        color: inherit;
                        border: none;
                        padding: 10px;
                        border-radius: 6px;
                        cursor: pointer;
                    ">Close</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    let currentData = '';
    let currentFormat: 'csv' | 'json' = 'json';
    
    const loadExport = async (format: 'csv' | 'json') => {
        currentFormat = format;
        const content = document.getElementById('exportContent');
        if (!content) return;
        
        try {
            const result = await Meteor.callAsync('poll.export', pollId, format) as any;
            currentData = typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
            content.textContent = currentData;
            
            // Update button styles
            document.getElementById('exportCSV')!.style.background = format === 'csv' 
                ? 'var(--rcx-button-primary-background-color, #156ff5)' 
                : 'var(--rcx-color-surface-neutral, #2f343d)';
            document.getElementById('exportCSV')!.style.color = format === 'csv' ? 'white' : 'inherit';
            document.getElementById('exportJSON')!.style.background = format === 'json' 
                ? 'var(--rcx-button-primary-background-color, #156ff5)' 
                : 'var(--rcx-color-surface-neutral, #2f343d)';
            document.getElementById('exportJSON')!.style.color = format === 'json' ? 'white' : 'inherit';
        } catch (err) {
            content.textContent = 'Failed to load export data';
        }
    };
    
    loadExport('json');
    
    document.getElementById('exportCSV')!.onclick = () => loadExport('csv');
    document.getElementById('exportJSON')!.onclick = () => loadExport('json');
    document.getElementById('closeExport')!.onclick = () => closeModal('exportModal');
    document.getElementById('exportOverlay')!.onclick = (e) => {
        if (e.target === e.currentTarget) closeModal('exportModal');
    };
    document.getElementById('copyExport')!.onclick = () => {
        navigator.clipboard.writeText(currentData);
        showToast('Copied to clipboard!', 'success');
    };
}

// ============================================================================
// Poll Button
// ============================================================================

function initPollButton() {
    const toolbar = document.querySelector('[data-qa="file-upload"]')?.parentElement ||
                   document.querySelector('.rc-message-box__actions');
    
    if (!toolbar || document.getElementById('rcPollBtn')) return;
    
    const btn = document.createElement('button');
    btn.id = 'rcPollBtn';
    btn.type = 'button';
    btn.title = 'Create Poll';
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
    </svg>`;
    btn.style.cssText = `
        background: none; border: none;
        color: var(--rcx-color-font-hint, #6c737a);
        cursor: pointer; padding: 8px; border-radius: 4px;
        display: flex; align-items: center; justify-content: center;
    `;
    btn.onmouseenter = () => btn.style.color = 'var(--rcx-button-primary-background-color, #156ff5)';
    btn.onmouseleave = () => btn.style.color = 'var(--rcx-color-font-hint, #6c737a)';
    btn.onclick = (e) => { e.preventDefault(); openPollModal(); };
    
    toolbar.appendChild(btn);
}

// ============================================================================
// Poll Creation Modal - Full Featured
// ============================================================================

export function showPollModal() { openPollModal(); }

function openPollModal() {
    closeModal('pollModal');
    
    const now = new Date();
    const minDateTime = new Date(now.getTime() + 5 * 60000).toISOString().slice(0, 16);
    
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
                width: 450px;
                max-width: 90vw;
                max-height: 85vh;
                overflow-y: auto;
            ">
                <h3 style="margin: 0 0 20px; font-size: 18px; display: flex; align-items: center; gap: 8px;">
                    <span>📊</span> Create Poll
                </h3>
                
                <!-- Question -->
                <div style="margin-bottom: 16px;">
                    <label style="display: block; font-size: 12px; color: var(--rcx-color-font-hint); margin-bottom: 4px; text-transform: uppercase;">
                        Question *
                    </label>
                    <input id="pQ" type="text" placeholder="What would you like to ask?" style="
                        width: 100%; padding: 10px 12px;
                        background: var(--rcx-color-surface-neutral, #2f343d);
                        color: inherit;
                        border: 1px solid var(--rcx-color-stroke-light, #3d4149);
                        border-radius: 6px; font-size: 14px; outline: none;
                        box-sizing: border-box;
                    ">
                </div>
                
                <!-- Options -->
                <div style="margin-bottom: 12px;">
                    <label style="display: block; font-size: 12px; color: var(--rcx-color-font-hint); margin-bottom: 4px; text-transform: uppercase;">
                        Options *
                    </label>
                    <div id="pOpts"></div>
                </div>
                
                <button id="pAdd" type="button" style="
                    background: transparent;
                    color: var(--rcx-button-primary-background-color, #156ff5);
                    border: 1px dashed currentColor;
                    padding: 6px 12px; border-radius: 4px;
                    cursor: pointer; font-size: 13px; margin-bottom: 16px;
                ">+ Add Option</button>
                
                <!-- Settings Section -->
                <div style="
                    background: var(--rcx-color-surface-neutral, #2f343d);
                    border-radius: 8px;
                    padding: 16px;
                    margin-bottom: 16px;
                ">
                    <div style="font-size: 12px; color: var(--rcx-color-font-hint); margin-bottom: 12px; text-transform: uppercase;">
                        Poll Settings
                    </div>
                    
                    <!-- Multiple Choice -->
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; margin-bottom: 12px;">
                        <input id="pMulti" type="checkbox" style="width: 18px; height: 18px; accent-color: #156ff5;">
                        <div>
                            <span style="font-size: 14px;">☑️ Allow multiple choices</span>
                            <span style="display: block; font-size: 11px; color: var(--rcx-color-font-hint);">
                                Users can select more than one option
                            </span>
                        </div>
                    </label>
                    
                    <!-- Anonymous -->
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; margin-bottom: 12px;">
                        <input id="pAnon" type="checkbox" style="width: 18px; height: 18px; accent-color: #156ff5;">
                        <div>
                            <span style="font-size: 14px;">🔒 Anonymous voting</span>
                            <span style="display: block; font-size: 11px; color: var(--rcx-color-font-hint);">
                                Votes are private - no one can see who voted
                            </span>
                        </div>
                    </label>
                    
                    <!-- Schedule -->
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                        <input id="pScheduleCheck" type="checkbox" style="width: 18px; height: 18px; accent-color: #156ff5;">
                        <div style="flex: 1;">
                            <span style="font-size: 14px;">⏰ Schedule for later</span>
                            <span style="display: block; font-size: 11px; color: var(--rcx-color-font-hint);">
                                Poll will be posted at the scheduled time
                            </span>
                        </div>
                    </label>
                    
                    <div id="pScheduleContainer" style="display: none; margin-top: 12px; padding-left: 28px;">
                        <input id="pScheduleTime" type="datetime-local" min="${minDateTime}" style="
                            width: 100%; padding: 8px;
                            background: var(--rcx-color-surface-room, #1f2329);
                            color: inherit;
                            border: 1px solid var(--rcx-color-stroke-light, #3d4149);
                            border-radius: 4px; font-size: 14px;
                        ">
                    </div>
                </div>
                
                <!-- Buttons -->
                <div style="display: flex; gap: 10px;">
                    <button id="pCancel" type="button" style="
                        flex: 1;
                        background: var(--rcx-color-surface-neutral, #2f343d);
                        color: inherit; border: none;
                        padding: 12px; border-radius: 6px;
                        cursor: pointer; font-size: 14px;
                    ">Cancel</button>
                    <button id="pCreate" type="button" style="
                        flex: 1;
                        background: var(--rcx-button-primary-background-color, #156ff5);
                        color: white; border: none;
                        padding: 12px; border-radius: 6px;
                        cursor: pointer; font-size: 14px; font-weight: 500;
                    ">Create Poll</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Add initial options
    const opts = document.getElementById('pOpts')!;
    addOpt(opts, 'A');
    addOpt(opts, 'B');
    
    setTimeout(() => (document.getElementById('pQ') as HTMLInputElement)?.focus(), 50);
    
    // Events
    document.getElementById('pCancel')!.onclick = () => closeModal('pollModal');
    document.getElementById('pCreate')!.onclick = createPoll;
    document.getElementById('pAdd')!.onclick = () => {
        const count = opts.querySelectorAll('input').length;
        if (count < 10) addOpt(opts, String.fromCharCode(65 + count));
        else showToast('Maximum 10 options', 'error');
    };
    document.getElementById('pollOverlay')!.onclick = (e) => {
        if (e.target === e.currentTarget) closeModal('pollModal');
    };
    document.getElementById('pScheduleCheck')!.onchange = (e) => {
        const container = document.getElementById('pScheduleContainer')!;
        container.style.display = (e.target as HTMLInputElement).checked ? 'block' : 'none';
    };
    
    const esc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { closeModal('pollModal'); document.removeEventListener('keydown', esc); }
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
            border-radius: 6px; font-size: 14px; outline: none;
        ">
        ${container.querySelectorAll('input').length >= 2 ? `
            <button type="button" class="pOptDel" style="
                background: transparent; border: none;
                color: var(--rcx-color-status-font-on-danger, #f5455c);
                cursor: pointer; padding: 4px; font-size: 16px;
            ">×</button>
        ` : ''}
    `;
    container.appendChild(row);
    
    const delBtn = row.querySelector('.pOptDel');
    if (delBtn) {
        delBtn.addEventListener('click', () => {
            if (container.querySelectorAll('input').length > 2) {
                row.remove();
                // Re-letter remaining options
                container.querySelectorAll('div').forEach((r, i) => {
                    const span = r.querySelector('span');
                    if (span) span.textContent = String.fromCharCode(65 + i);
                });
            }
        });
    }
    
    if (container.querySelectorAll('input').length > 2) {
        row.querySelector('input')?.focus();
    }
}

async function createPoll() {
    const q = (document.getElementById('pQ') as HTMLInputElement)?.value.trim();
    const opts = Array.from(document.querySelectorAll('.pOptIn') as NodeListOf<HTMLInputElement>)
        .map(i => i.value.trim()).filter(Boolean);
    const multi = (document.getElementById('pMulti') as HTMLInputElement)?.checked;
    const anon = (document.getElementById('pAnon') as HTMLInputElement)?.checked;
    const scheduleEnabled = (document.getElementById('pScheduleCheck') as HTMLInputElement)?.checked;
    const scheduleTime = (document.getElementById('pScheduleTime') as HTMLInputElement)?.value;
    
    // Validation
    if (!q) { showToast('Please enter a question', 'error'); return; }
    if (opts.length < 2) { showToast('Add at least 2 options', 'error'); return; }
    
    const roomId = RoomManager.opened;
    if (!roomId) { showToast('Please open a room first', 'error'); return; }
    
    // Validate schedule
    let scheduledFor: Date | undefined;
    if (scheduleEnabled) {
        if (!scheduleTime) {
            showToast('Please select a schedule time', 'error');
            return;
        }
        scheduledFor = new Date(scheduleTime);
        if (scheduledFor <= new Date()) {
            showToast('Schedule time must be in the future', 'error');
            return;
        }
    }
    
    const btn = document.getElementById('pCreate') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = scheduleEnabled ? 'Scheduling...' : 'Creating...';
    
    try {
        const result = await Meteor.callAsync('poll.create', {
            question: q,
            options: opts,
            allowMultiple: multi,
            isAnonymous: anon,
            scheduledFor,
            roomId
        }) as any;
        
        closeModal('pollModal');
        
        if (result.scheduled) {
            showToast(`Poll scheduled for ${new Date(result.scheduledFor).toLocaleString()}`, 'success');
        } else {
            showToast('Poll created successfully!', 'success');
        }
    } catch (err: any) {
        showToast(err.reason || 'Failed to create poll', 'error');
        btn.disabled = false;
        btn.textContent = 'Create Poll';
    }
}

// ============================================================================
// Utilities
// ============================================================================

function closeModal(id: string) {
    document.getElementById(id)?.remove();
}

function showToast(msg: string, type: 'success' | 'error') {
    document.querySelectorAll('.pToast').forEach(t => t.remove());
    
    const t = document.createElement('div');
    t.className = 'pToast';
    t.style.cssText = `
        position: fixed; top: 16px; right: 16px; z-index: 999999;
        background: ${type === 'success' ? '#2de0a5' : '#f5455c'};
        color: ${type === 'success' ? '#1a1a1a' : '#fff'};
        padding: 12px 18px; border-radius: 6px;
        font-size: 14px; font-weight: 500;
        box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        display: flex; align-items: center; gap: 8px;
        animation: toastIn 0.2s ease;
    `;
    t.innerHTML = `<span>${type === 'success' ? '✓' : '✕'}</span><span>${msg}</span>`;
    
    if (!document.getElementById('toastStyle')) {
        const s = document.createElement('style');
        s.id = 'toastStyle';
        s.textContent = '@keyframes toastIn { from { opacity: 0; transform: translateY(-10px); } }';
        document.head.appendChild(s);
    }
    
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
}
