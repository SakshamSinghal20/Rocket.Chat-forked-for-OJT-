// Poll System - Enhanced UI/UX with Admin Controls & Beautiful Design
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
    injectStyles();
});

// ============================================================================
// Inject Beautiful Styles
// ============================================================================

function injectStyles() {
    if (document.getElementById('pollStyles')) return;
    
    const styles = document.createElement('style');
    styles.id = 'pollStyles';
    styles.textContent = `
        @keyframes pollFadeIn {
            from { opacity: 0; transform: translateY(-10px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes pollSlideUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pollPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.02); }
        }
        @keyframes pollShimmer {
            0% { background-position: -200% 0; }
            100% { background-position: 200% 0; }
        }
        @keyframes pollToastIn {
            from { opacity: 0; transform: translateX(100%) scale(0.8); }
            to { opacity: 1; transform: translateX(0) scale(1); }
        }
        @keyframes pollCheckmark {
            0% { transform: scale(0) rotate(-45deg); }
            50% { transform: scale(1.2) rotate(-45deg); }
            100% { transform: scale(1) rotate(0deg); }
        }
        
        .poll-modal-overlay {
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
        }
        
        .poll-modal-content {
            animation: pollFadeIn 0.3s ease-out;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }
        
        .poll-input {
            transition: all 0.2s ease;
            border: 2px solid transparent !important;
        }
        
        .poll-input:focus {
            border-color: #6366f1 !important;
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
        }
        
        .poll-option-row {
            animation: pollSlideUp 0.3s ease-out;
            animation-fill-mode: both;
        }
        
        .poll-btn-primary {
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);
        }
        
        .poll-btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(99, 102, 241, 0.5);
        }
        
        .poll-btn-primary:active {
            transform: translateY(0);
        }
        
        .poll-btn-secondary {
            transition: all 0.2s ease;
        }
        
        .poll-btn-secondary:hover {
            background: rgba(255, 255, 255, 0.1);
        }
        
        .poll-setting-card {
            transition: all 0.2s ease;
            border: 2px solid transparent;
        }
        
        .poll-setting-card:hover {
            border-color: rgba(99, 102, 241, 0.3);
            background: rgba(99, 102, 241, 0.05);
        }
        
        .poll-toast {
            animation: pollToastIn 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        }
        
        .poll-gradient-text {
            background: linear-gradient(135deg, #6366f1, #a855f7, #ec4899);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
    `;
    document.head.appendChild(styles);
}

// ============================================================================
// Vote & Action Handler
// ============================================================================

function setupVoteHandler() {
    document.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;
        const button = target.closest('button') as HTMLButtonElement;
        if (!button) return;
        
        const actionId = button.getAttribute('data-action-id') || button.dataset?.actionId || '';
        const value = button.getAttribute('data-value') || button.dataset?.value || button.getAttribute('value') || '';
        
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
            
            // Add visual feedback
            button.style.opacity = '0.7';
            button.style.pointerEvents = 'none';
            
            try {
                await Meteor.callAsync('poll.vote', pollId, optionId);
                showToast('Vote recorded! ✓', 'success');
            } catch (err: any) {
                showToast(err.reason || 'Vote failed', 'error');
            } finally {
                button.style.opacity = '1';
                button.style.pointerEvents = 'auto';
            }
            return;
        }
        
        // Close action (Admin only)
        if (actionId.startsWith('close_')) {
            e.preventDefault();
            e.stopPropagation();
            
            const pollId = value.replace('close_', '');
            
            try {
                // Check if user is admin first
                const isAdmin = await Meteor.callAsync('poll.checkAdmin');
                if (!isAdmin) {
                    showToast('Only administrators can close polls', 'error');
                    return;
                }
                
                await Meteor.callAsync('poll.close', pollId);
                showToast('Poll closed! Results published 📊', 'success');
            } catch (err: any) {
                showToast(err.reason || 'Failed to close poll', 'error');
            }
            return;
        }
    }, true);
}

// ============================================================================
// Poll Button - Enhanced Design
// ============================================================================

function initPollButton() {
    const toolbar = document.querySelector('[data-qa="file-upload"]')?.parentElement ||
                   document.querySelector('.rc-message-box__actions');
    
    if (!toolbar || document.getElementById('rcPollBtn')) return;
    
    const btn = document.createElement('button');
    btn.id = 'rcPollBtn';
    btn.type = 'button';
    btn.title = 'Create Poll';
    btn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 20V10"/>
            <path d="M12 20V4"/>
            <path d="M6 20v-6"/>
        </svg>
    `;
    btn.style.cssText = `
        background: none;
        border: none;
        color: var(--rcx-color-font-hint, #6c737a);
        cursor: pointer;
        padding: 8px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
    `;
    
    btn.onmouseenter = () => {
        btn.style.color = '#6366f1';
        btn.style.background = 'rgba(99, 102, 241, 0.1)';
        btn.style.transform = 'scale(1.1)';
    };
    btn.onmouseleave = () => {
        btn.style.color = 'var(--rcx-color-font-hint, #6c737a)';
        btn.style.background = 'none';
        btn.style.transform = 'scale(1)';
    };
    btn.onclick = (e) => { e.preventDefault(); openPollModal(); };
    
    toolbar.appendChild(btn);
}

// ============================================================================
// Poll Creation Modal - Beautiful Design
// ============================================================================

export function showPollModal() { openPollModal(); }

function openPollModal() {
    closeModal('pollModal');
    
    const now = new Date();
    const minDateTime = new Date(now.getTime() + 5 * 60000).toISOString().slice(0, 16);
    
    const modal = document.createElement('div');
    modal.id = 'pollModal';
    modal.innerHTML = `
        <div class="poll-modal-overlay" style="
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.7);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        ">
            <div class="poll-modal-content" style="
                background: linear-gradient(145deg, #1e1e2e 0%, #181825 100%);
                padding: 32px;
                border-radius: 20px;
                color: #cdd6f4;
                width: 480px;
                max-width: 100%;
                max-height: 90vh;
                overflow-y: auto;
                border: 1px solid rgba(255, 255, 255, 0.1);
            ">
                <!-- Header -->
                <div style="text-align: center; margin-bottom: 28px;">
                    <div style="
                        width: 60px;
                        height: 60px;
                        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
                        border-radius: 16px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        margin: 0 auto 16px;
                        box-shadow: 0 8px 25px rgba(99, 102, 241, 0.4);
                    ">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                            <path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>
                        </svg>
                    </div>
                    <h2 style="margin: 0; font-size: 24px; font-weight: 700;" class="poll-gradient-text">
                        Create a Poll
                    </h2>
                    <p style="margin: 8px 0 0; font-size: 14px; color: #a6adc8;">
                        Ask your team and get instant feedback
                    </p>
                </div>
                
                <!-- Question -->
                <div style="margin-bottom: 24px;">
                    <label style="
                        display: block;
                        font-size: 12px;
                        font-weight: 600;
                        color: #a6adc8;
                        margin-bottom: 8px;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    ">
                        📝 Your Question
                    </label>
                    <input id="pQ" type="text" placeholder="What would you like to ask?" class="poll-input" style="
                        width: 100%;
                        padding: 14px 16px;
                        background: rgba(255, 255, 255, 0.05);
                        color: #cdd6f4;
                        border: 2px solid rgba(255, 255, 255, 0.1);
                        border-radius: 12px;
                        font-size: 15px;
                        outline: none;
                        box-sizing: border-box;
                    ">
                </div>
                
                <!-- Options -->
                <div style="margin-bottom: 20px;">
                    <label style="
                        display: block;
                        font-size: 12px;
                        font-weight: 600;
                        color: #a6adc8;
                        margin-bottom: 8px;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    ">
                        🎯 Answer Options
                    </label>
                    <div id="pOpts"></div>
                </div>
                
                <button id="pAdd" type="button" style="
                    background: rgba(99, 102, 241, 0.1);
                    color: #6366f1;
                    border: 2px dashed rgba(99, 102, 241, 0.4);
                    padding: 10px 16px;
                    border-radius: 10px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                    margin-bottom: 24px;
                    width: 100%;
                    transition: all 0.2s ease;
                ">
                    + Add Another Option
                </button>
                
                <!-- Settings -->
                <div style="
                    background: rgba(255, 255, 255, 0.03);
                    border-radius: 16px;
                    padding: 20px;
                    margin-bottom: 24px;
                    border: 1px solid rgba(255, 255, 255, 0.05);
                ">
                    <div style="
                        font-size: 12px;
                        font-weight: 600;
                        color: #a6adc8;
                        margin-bottom: 16px;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                    ">
                        ⚙️ Poll Settings
                    </div>
                    
                    <!-- Multiple Choice -->
                    <label class="poll-setting-card" style="
                        display: flex;
                        align-items: flex-start;
                        gap: 14px;
                        cursor: pointer;
                        padding: 14px;
                        border-radius: 12px;
                        margin-bottom: 12px;
                        background: rgba(255, 255, 255, 0.02);
                    ">
                        <input id="pMulti" type="checkbox" style="
                            width: 20px;
                            height: 20px;
                            accent-color: #6366f1;
                            margin-top: 2px;
                        ">
                        <div>
                            <span style="font-size: 15px; font-weight: 500; color: #cdd6f4;">
                                ☑️ Multiple Choices
                            </span>
                            <span style="display: block; font-size: 13px; color: #6c7086; margin-top: 4px;">
                                Allow selecting more than one option
                            </span>
                        </div>
                    </label>
                    
                    <!-- Anonymous -->
                    <label class="poll-setting-card" style="
                        display: flex;
                        align-items: flex-start;
                        gap: 14px;
                        cursor: pointer;
                        padding: 14px;
                        border-radius: 12px;
                        margin-bottom: 12px;
                        background: rgba(255, 255, 255, 0.02);
                    ">
                        <input id="pAnon" type="checkbox" style="
                            width: 20px;
                            height: 20px;
                            accent-color: #6366f1;
                            margin-top: 2px;
                        ">
                        <div>
                            <span style="font-size: 15px; font-weight: 500; color: #cdd6f4;">
                                🔒 Anonymous Voting
                            </span>
                            <span style="display: block; font-size: 13px; color: #6c7086; margin-top: 4px;">
                                Keep all votes completely private
                            </span>
                        </div>
                    </label>
                    
                    <!-- Schedule -->
                    <label class="poll-setting-card" style="
                        display: flex;
                        align-items: flex-start;
                        gap: 14px;
                        cursor: pointer;
                        padding: 14px;
                        border-radius: 12px;
                        background: rgba(255, 255, 255, 0.02);
                    ">
                        <input id="pScheduleCheck" type="checkbox" style="
                            width: 20px;
                            height: 20px;
                            accent-color: #6366f1;
                            margin-top: 2px;
                        ">
                        <div style="flex: 1;">
                            <span style="font-size: 15px; font-weight: 500; color: #cdd6f4;">
                                ⏰ Schedule for Later
                            </span>
                            <span style="display: block; font-size: 13px; color: #6c7086; margin-top: 4px;">
                                Post the poll at a specific time
                            </span>
                        </div>
                    </label>
                    
                    <div id="pScheduleContainer" style="display: none; margin-top: 12px; padding-left: 34px;">
                        <input id="pScheduleTime" type="datetime-local" min="${minDateTime}" class="poll-input" style="
                            width: 100%;
                            padding: 12px;
                            background: rgba(255, 255, 255, 0.05);
                            color: #cdd6f4;
                            border: 2px solid rgba(255, 255, 255, 0.1);
                            border-radius: 10px;
                            font-size: 14px;
                        ">
                    </div>
                </div>
                
                <!-- Buttons -->
                <div style="display: flex; gap: 12px;">
                    <button id="pCancel" type="button" class="poll-btn-secondary" style="
                        flex: 1;
                        background: rgba(255, 255, 255, 0.05);
                        color: #cdd6f4;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        padding: 14px;
                        border-radius: 12px;
                        cursor: pointer;
                        font-size: 15px;
                        font-weight: 500;
                    ">Cancel</button>
                    <button id="pCreate" type="button" class="poll-btn-primary" style="
                        flex: 2;
                        background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
                        color: white;
                        border: none;
                        padding: 14px;
                        border-radius: 12px;
                        cursor: pointer;
                        font-size: 15px;
                        font-weight: 600;
                    ">🚀 Create Poll</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const opts = document.getElementById('pOpts')!;
    addOpt(opts, 'A', 0);
    addOpt(opts, 'B', 1);
    
    setTimeout(() => (document.getElementById('pQ') as HTMLInputElement)?.focus(), 100);
    
    // Events
    document.getElementById('pCancel')!.onclick = () => closeModal('pollModal');
    document.getElementById('pCreate')!.onclick = createPoll;
    document.getElementById('pAdd')!.onclick = () => {
        const count = opts.querySelectorAll('input').length;
        if (count < 10) addOpt(opts, String.fromCharCode(65 + count), count);
        else showToast('Maximum 10 options', 'error');
    };
    document.querySelector('.poll-modal-overlay')!.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal('pollModal');
    });
    document.getElementById('pScheduleCheck')!.onchange = (e) => {
        document.getElementById('pScheduleContainer')!.style.display = 
            (e.target as HTMLInputElement).checked ? 'block' : 'none';
    };
    
    const esc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { closeModal('pollModal'); document.removeEventListener('keydown', esc); }
    };
    document.addEventListener('keydown', esc);
}

const OPTION_COLORS = ['#f87171', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#f472b6', '#38bdf8', '#4ade80', '#facc15', '#c084fc'];

function addOpt(container: HTMLElement, letter: string, index: number) {
    const color = OPTION_COLORS[index % OPTION_COLORS.length];
    const row = document.createElement('div');
    row.className = 'poll-option-row';
    row.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 10px;
        animation-delay: ${index * 0.05}s;
    `;
    row.innerHTML = `
        <div style="
            width: 32px;
            height: 32px;
            background: ${color}20;
            border: 2px solid ${color};
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            font-size: 14px;
            color: ${color};
        ">${letter}</div>
        <input class="pOptIn poll-input" type="text" placeholder="Enter option ${letter}" style="
            flex: 1;
            padding: 12px 14px;
            background: rgba(255, 255, 255, 0.05);
            color: #cdd6f4;
            border: 2px solid rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            font-size: 14px;
            outline: none;
        ">
        ${container.querySelectorAll('input').length >= 2 ? `
            <button type="button" class="pOptDel" style="
                background: rgba(239, 68, 68, 0.1);
                border: none;
                color: #ef4444;
                cursor: pointer;
                padding: 8px;
                border-radius: 8px;
                font-size: 18px;
                line-height: 1;
                transition: all 0.2s;
            ">×</button>
        ` : ''}
    `;
    container.appendChild(row);
    
    const delBtn = row.querySelector('.pOptDel');
    if (delBtn) {
        delBtn.addEventListener('click', () => {
            if (container.querySelectorAll('input').length > 2) {
                row.style.animation = 'pollFadeIn 0.2s ease reverse';
                setTimeout(() => {
                    row.remove();
                    relabelOptions(container);
                }, 200);
            }
        });
    }
    
    if (container.querySelectorAll('input').length > 2) {
        row.querySelector('input')?.focus();
    }
}

function relabelOptions(container: Element) {
    container.querySelectorAll('.poll-option-row').forEach((row, i) => {
        const label = row.querySelector('div');
        const input = row.querySelector('input');
        const letter = String.fromCharCode(65 + i);
        const color = OPTION_COLORS[i % OPTION_COLORS.length];
        
        if (label) {
            label.textContent = letter;
            label.style.borderColor = color;
            label.style.color = color;
            label.style.background = `${color}20`;
        }
        if (input) input.placeholder = `Enter option ${letter}`;
    });
}

async function createPoll() {
    const q = (document.getElementById('pQ') as HTMLInputElement)?.value.trim();
    const opts = Array.from(document.querySelectorAll('.pOptIn') as NodeListOf<HTMLInputElement>)
        .map(i => i.value.trim()).filter(Boolean);
    const multi = (document.getElementById('pMulti') as HTMLInputElement)?.checked;
    const anon = (document.getElementById('pAnon') as HTMLInputElement)?.checked;
    const scheduleEnabled = (document.getElementById('pScheduleCheck') as HTMLInputElement)?.checked;
    const scheduleTime = (document.getElementById('pScheduleTime') as HTMLInputElement)?.value;
    
    if (!q) { showToast('Please enter a question', 'error'); return; }
    if (opts.length < 2) { showToast('Add at least 2 options', 'error'); return; }
    
    const roomId = RoomManager.opened;
    if (!roomId) { showToast('Please open a room first', 'error'); return; }
    
    let scheduledFor: Date | undefined;
    if (scheduleEnabled) {
        if (!scheduleTime) { showToast('Please select a schedule time', 'error'); return; }
        scheduledFor = new Date(scheduleTime);
        if (scheduledFor <= new Date()) { showToast('Schedule time must be in the future', 'error'); return; }
    }
    
    const btn = document.getElementById('pCreate') as HTMLButtonElement;
    btn.disabled = true;
    btn.innerHTML = '<span style="display: inline-block; animation: pollPulse 1s infinite;">Creating...</span>';
    
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
            showToast(`⏰ Poll scheduled for ${new Date(result.scheduledFor).toLocaleString()}`, 'success');
        } else {
            showToast('🎉 Poll created successfully!', 'success');
        }
    } catch (err: any) {
        showToast(err.reason || 'Failed to create poll', 'error');
        btn.disabled = false;
        btn.innerHTML = '🚀 Create Poll';
    }
}

// ============================================================================
// Utilities
// ============================================================================

function closeModal(id: string) {
    const modal = document.getElementById(id);
    if (modal) {
        modal.style.animation = 'pollFadeIn 0.2s ease reverse';
        setTimeout(() => modal.remove(), 200);
    }
}

function showToast(msg: string, type: 'success' | 'error') {
    document.querySelectorAll('.poll-toast').forEach(t => t.remove());
    
    const isSuccess = type === 'success';
    const t = document.createElement('div');
    t.className = 'poll-toast';
    t.style.cssText = `
        position: fixed;
        top: 24px;
        right: 24px;
        z-index: 999999;
        background: ${isSuccess ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'};
        color: white;
        padding: 16px 24px;
        border-radius: 14px;
        font-size: 15px;
        font-weight: 500;
        box-shadow: 0 10px 40px ${isSuccess ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'};
        display: flex;
        align-items: center;
        gap: 12px;
    `;
    
    const icon = isSuccess ? '✓' : '✕';
    t.innerHTML = `
        <span style="
            width: 24px;
            height: 24px;
            background: rgba(255,255,255,0.2);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
        ">${icon}</span>
        <span>${msg}</span>
    `;
    
    document.body.appendChild(t);
    setTimeout(() => {
        t.style.animation = 'pollToastIn 0.3s ease reverse';
        setTimeout(() => t.remove(), 300);
    }, 4000);
}
