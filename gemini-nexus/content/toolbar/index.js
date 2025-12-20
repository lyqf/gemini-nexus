
// content/toolbar/index.js (formerly content_toolbar.js)

class FloatingToolbar {
    constructor() {
        // Dependencies
        this.ui = new window.GeminiToolbarUI();
        this.actions = new window.GeminiToolbarActions(this.ui);
        
        // Sub-Modules
        this.imageDetector = new window.GeminiImageDetector({
            onShow: (rect) => this.ui.showImageButton(rect),
            onHide: () => this.ui.hideImageButton()
        });

        this.streamHandler = new window.GeminiStreamHandler(this.ui, {
            onSessionId: (id) => { this.lastSessionId = id; }
        });

        // State
        this.visible = false;
        this.currentSelection = "";
        this.lastRect = null;
        this.lastSessionId = null;
        this.sourceInputElement = null;
        this.sourceSelectionRange = null;
        this.sourceSelectionStart = null;
        this.sourceSelectionEnd = null;
        
        // Bind methods
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.handleAction = this.handleAction.bind(this);
        
        this.init();
    }

    init() {
        // Initialize UI
        this.ui.build();
        this.ui.setCallbacks({
            onAction: this.handleAction,
            onImageBtnHover: (isHovering) => {
                if (isHovering) {
                    this.imageDetector.cancelHide();
                } else {
                    this.imageDetector.scheduleHide();
                }
            }
        });

        // Initialize Modules
        this.imageDetector.init();
        this.streamHandler.init();

        this.attachListeners();
    }

    attachListeners() {
        document.addEventListener('mouseup', this.onMouseUp);
        document.addEventListener('mousedown', this.onMouseDown);
    }

    handleAction(actionType, data) {
        // --- Copy Selection ---
        if (actionType === 'copy_selection') {
            if (this.currentSelection) {
                navigator.clipboard.writeText(this.currentSelection)
                    .then(() => this.ui.showCopySelectionFeedback(true))
                    .catch((err) => {
                        console.error("Failed to copy text:", err);
                        this.ui.showCopySelectionFeedback(false);
                    });
            }
            return;
        }

        // --- Image Analysis ---
        if (actionType === 'image_analyze') {
            const img = this.imageDetector.getCurrentImage();
            if (!img) return;
            
            const imgUrl = img.src;
            const rect = img.getBoundingClientRect();

            this.ui.hideImageButton();
            this.actions.handleImageAnalyze(imgUrl, rect);
            return;
        }

        // --- Manual Ask (UI Only) ---
        if (actionType === 'ask') {
            if (this.currentSelection) {
                this.ui.hide(); // Hide small toolbar
                this.ui.showAskWindow(this.lastRect, this.currentSelection, "询问");
            }
            return;
        }

        // --- Quick Actions (Translate / Explain / Summarize) ---
        if (actionType === 'translate' || actionType === 'explain' || actionType === 'summarize') {
            if (!this.currentSelection) return;
            this.actions.handleQuickAction(actionType, this.currentSelection, this.lastRect);
            return;
        }

        // --- Grammar Fix (with source tracking) ---
        if (actionType === 'grammar') {
            if (!this.currentSelection) return;
            // Use previously captured source input element from onMouseUp
            this.ui.setGrammarMode(true, this.sourceInputElement, this.sourceSelectionRange);
            this.actions.handleQuickAction(actionType, this.currentSelection, this.lastRect);
            return;
        }

        // --- Insert Result ---
        if (actionType === 'insert_result') {
            const resultText = data;
            this.insertTextAtSource(resultText, false);
            return;
        }

        // --- Replace Result ---
        if (actionType === 'replace_result') {
            const resultText = data;
            this.insertTextAtSource(resultText, true);
            return;
        }

        // --- Submit Question ---
        if (actionType === 'submit_ask') {
            const question = data; // data is the input text
            const context = this.currentSelection;
            if (question) {
                this.actions.handleSubmitAsk(question, context);
            }
            return;
        }
        
        // --- Retry ---
        if (actionType === 'retry_ask') {
            this.actions.handleRetry();
            return;
        }

        // --- Cancel ---
        if (actionType === 'cancel_ask') {
            this.actions.handleCancel(); // Send cancel to bg
            this.ui.hideAskWindow();
            this.visible = false;
            return;
        }

        // --- Continue Chat ---
        if (actionType === 'continue_chat') {
            this.actions.handleContinueChat(this.lastSessionId);
            this.ui.hideAskWindow();
            this.visible = false;
            return;
        }
    }

    onMouseDown(e) {
        // If clicking inside our toolbar/window, do nothing
        if (this.ui.isHost(e.target)) return;
        
        // If pinned OR docked, do not hide the window on outside click
        // Docked implies a persistent state, pinned to the edge.
        if (this.ui.isPinned || this.ui.isDocked) {
            // Only hide the small selection toolbar if clicking outside
            if (this.visible && !this.ui.isWindowVisible()) {
                this.hide();
            }
            return;
        }

        this.hide();
    }

    onMouseUp(e) {
        // Capture coordinates immediately
        const mouseX = e.clientX;
        const mouseY = e.clientY;

        // Delay slightly to let selection finalize
        setTimeout(() => {
            const selection = window.getSelection();
            const text = selection.toString().trim();

            if (text.length > 0) {
                this.currentSelection = text;
                const range = selection.getRangeAt(0);
                const rect = range.getBoundingClientRect();

                // Capture source input element for potential grammar fix
                this.captureSourceInput();

                // Show/hide grammar button based on whether selection is in editable element
                this.ui.showGrammarButton(!!this.sourceInputElement);

                // Pass mouse coordinates
                this.show(rect, { x: mouseX, y: mouseY });
            } else {
                // Only hide if we aren't currently interacting with the Ask Window
                if (!this.ui.isWindowVisible()) {
                    this.currentSelection = "";
                    this.sourceInputElement = null;
                    this.sourceSelectionRange = null;
                    this.sourceSelectionStart = null;
                    this.sourceSelectionEnd = null;
                    this.hide();
                }
            }
        }, 10);
    }

    show(rect, mousePoint) {
        this.lastRect = rect;
        this.ui.show(rect, mousePoint);
        this.visible = true;
    }

    hide() {
        if (this.ui.isWindowVisible()) return;
        if (!this.visible) return;
        this.ui.hide();
        this.visible = false;
    }

    showGlobalInput() {
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        const width = 400;
        const height = 100;

        // Create a virtual rect roughly in the center-top area
        const left = (viewportW - width) / 2;
        const top = (viewportH / 2) - 200;

        const rect = {
            left: left,
            top: top,
            right: left + width,
            bottom: top + height,
            width: width,
            height: height
        };

        this.ui.hide(); // Hide small selection toolbar

        // Show window with no context
        this.ui.showAskWindow(rect, null, "询问");

        // Reset state for new question
        this.ui.setInputValue("");
        this.currentSelection = ""; // Ensure context is clear for submission
    }

    captureSourceInput() {
        // First, check if the active element is an input/textarea
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
            // For input/textarea, use the element itself and its selection properties
            const start = activeElement.selectionStart;
            const end = activeElement.selectionEnd;
            if (start !== null && end !== null && start !== end) {
                this.sourceInputElement = activeElement;
                this.sourceSelectionRange = null;
                this.sourceSelectionStart = start;
                this.sourceSelectionEnd = end;
                return;
            }
        }

        // For contenteditable or other elements, use window.getSelection()
        const selection = window.getSelection();
        if (!selection.rangeCount) {
            this.sourceInputElement = null;
            this.sourceSelectionRange = null;
            this.sourceSelectionStart = null;
            this.sourceSelectionEnd = null;
            return;
        }

        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;

        // Find the closest editable element (contenteditable)
        let editableElement = null;
        let node = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;

        while (node && node !== document.body) {
            if (node.isContentEditable) {
                editableElement = node;
                break;
            }
            node = node.parentElement;
        }

        if (editableElement) {
            this.sourceInputElement = editableElement;
            this.sourceSelectionRange = range.cloneRange();
            this.sourceSelectionStart = null;
            this.sourceSelectionEnd = null;
        } else {
            this.sourceInputElement = null;
            this.sourceSelectionRange = null;
            this.sourceSelectionStart = null;
            this.sourceSelectionEnd = null;
        }
    }

    insertTextAtSource(text, replace = false) {
        const element = this.sourceInputElement;
        const range = this.sourceSelectionRange;

        if (!element) {
            console.warn("Cannot insert: Selection was not in an editable element");
            // Fallback: copy to clipboard instead
            navigator.clipboard.writeText(text).then(() => {
                this.ui.showError("Text copied to clipboard (not in editable field)");
            }).catch(() => {
                this.ui.showError("Cannot insert: not in editable field");
            });
            return;
        }

        if (!text) {
            console.warn("Cannot insert: No text to insert");
            return;
        }

        try {
            // Handle textarea and input elements
            if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
                // Use saved selection positions
                const start = this.sourceSelectionStart !== null ? this.sourceSelectionStart : 0;
                const end = this.sourceSelectionEnd !== null ? this.sourceSelectionEnd : start;
                const value = element.value;

                element.focus();

                if (replace) {
                    // Replace selected text
                    element.value = value.substring(0, start) + text + value.substring(end);
                    element.selectionStart = element.selectionEnd = start + text.length;
                } else {
                    // Insert at cursor position (after selection)
                    element.value = value.substring(0, end) + text + value.substring(end);
                    element.selectionStart = element.selectionEnd = end + text.length;
                }

                // Trigger input event
                element.dispatchEvent(new Event('input', { bubbles: true }));

            } else if (element.isContentEditable) {
                // Handle contenteditable elements
                element.focus();

                if (replace && range) {
                    // Restore the selection and replace
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(range);

                    // Delete selected content and insert new text
                    document.execCommand('insertText', false, text);
                } else {
                    // Insert at the end of the previous selection
                    if (range) {
                        const selection = window.getSelection();
                        selection.removeAllRanges();

                        // Move to the end of the selection
                        const endRange = range.cloneRange();
                        endRange.collapse(false);
                        selection.addRange(endRange);
                    }

                    document.execCommand('insertText', false, text);
                }

                // Trigger input event
                element.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // Hide Insert/Replace buttons after successful operation
            this.ui.showInsertReplaceButtons(false);

        } catch (err) {
            console.error("Failed to insert text:", err);
        }
    }
}

window.GeminiFloatingToolbar = FloatingToolbar;
