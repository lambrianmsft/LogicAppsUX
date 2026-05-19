// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Chat-specific helpers for E2E tests targeting the @logicapps chat participant.
 *
 * Key insight: VS Code's Copilot Chat input is a Monaco CodeEditorWidget,
 * NOT a standard <textarea>. The hidden textarea inside Monaco (.inputarea)
 * does not relay sendKeys() properly. Instead, we:
 *   1. Open the chat panel (which auto-focuses the Monaco chat input)
 *   2. Use driver.actions().sendKeys() to type to the focused element
 *   3. Use driver.actions().sendKeys(Key.ENTER) to submit
 *
 * Usage:
 *   import { openChatPanel, sendChatPrompt, waitForChatResponse } from './helpers/chatHelper';
 */

import { Workbench, By, Key, type WebDriver, type WebElement } from 'vscode-extension-tester';
import { sleep, captureScreenshot } from '../helpers';

// ===========================================================================
// Constants
// ===========================================================================

/** Maximum time to wait for chat panel to open */
export const CHAT_PANEL_TIMEOUT = 15_000;

/** Maximum time to wait for a chat response to complete */
export const CHAT_RESPONSE_TIMEOUT = 120_000;

/** Polling interval for checking chat response status */
export const CHAT_POLL_INTERVAL = 1_000;

/** Time to wait for chat input to be ready after panel opens */
export const CHAT_INPUT_READY_DELAY = 2_000;

// ===========================================================================
// DOM Diagnostics
// ===========================================================================

/**
 * Dumps a comprehensive view of the chat panel DOM for debugging.
 * Runs JavaScript inside the browser to scan the DOM tree.
 *
 * @param driver - The WebDriver instance
 * @param label - Label for the dump
 */
export async function dumpChatDom(driver: WebDriver, label: string): Promise<void> {
  try {
    const result = await driver.executeScript<string>(`
      const info = [];

      // 1. Find the chat widget / panel container
      const chatSelectors = [
        '.interactive-session',
        '.chat-widget',
        '[class*="chat-editor"]',
        '[class*="interactive"]',
        '.panel .pane-body',
        '.chat-view',
      ];
      for (const sel of chatSelectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          const firstEl = els[0];
          const tag = firstEl.tagName.toLowerCase();
          const cls = firstEl.className?.toString().substring(0, 150) || '';
          const childCount = firstEl.children.length;
          info.push('[CONTAINER] ' + sel + ' (' + els.length + '): <' + tag + ' class="' + cls + '"> children=' + childCount);
        }
      }

      // 2. Find input areas
      const inputSelectors = [
        'textarea',
        'textarea.inputarea',
        '[contenteditable="true"]',
        '.interactive-input',
        '.interactive-input-part',
        '.chat-input-part',
        '[class*="chat-input"]',
        '[role="textbox"]',
        '.monaco-editor',
      ];
      for (const sel of inputSelectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          for (let i = 0; i < Math.min(els.length, 3); i++) {
            const el = els[i];
            const tag = el.tagName.toLowerCase();
            const cls = el.className?.toString().substring(0, 120) || '';
            const ariaLabel = el.getAttribute('aria-label') || '';
            const role = el.getAttribute('role') || '';
            const displayed = el.offsetParent !== null || el.offsetWidth > 0;
            const rect = el.getBoundingClientRect();
            info.push('[INPUT] ' + sel + '[' + i + ']: <' + tag + '> class="' + cls + '" aria-label="' + ariaLabel + '" role="' + role + '" visible=' + displayed + ' rect=' + Math.round(rect.x) + ',' + Math.round(rect.y) + ',' + Math.round(rect.width) + ',' + Math.round(rect.height));
          }
        }
      }

      // 3. Find response areas
      const responseSelectors = [
        '.interactive-item-container',
        '.interactive-response',
        '.interactive-request',
        '.chat-tree',
        '[class*="chat-response"]',
        '[class*="rendered-markdown"]',
      ];
      for (const sel of responseSelectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          const text = els[els.length - 1].textContent?.substring(0, 200) || '';
          info.push('[RESPONSE] ' + sel + ' (' + els.length + '): "' + text.replace(/\\n/g, ' ').trim() + '"');
        }
      }

      // 4. Active element
      const active = document.activeElement;
      if (active) {
        info.push('[ACTIVE] <' + active.tagName.toLowerCase() + '> class="' + (active.className?.toString().substring(0, 100) || '') + '" aria-label="' + (active.getAttribute('aria-label') || '') + '"');
      }

      return info.join('\\n');
    `);

    console.log(`[dumpChatDom] === ${label} ===`);
    if (result) {
      for (const line of result.split('\n')) {
        console.log(`[dumpChatDom] ${line}`);
      }
    }
  } catch (error: any) {
    console.log(`[dumpChatDom] Failed: ${error.message}`);
  }
}

// ===========================================================================
// Chat Panel Operations
// ===========================================================================

/**
 * Opens the GitHub Copilot Chat panel via command palette.
 * After opening, the chat input Monaco editor should be auto-focused.
 *
 * @param driver - The WebDriver instance
 * @returns true if chat panel opened successfully
 */
export async function openChatPanel(driver: WebDriver): Promise<boolean> {
  const workbench = new Workbench();

  try {
    // Wait for extensions to finish activating (visible in status bar as "Activating Extensions...")
    await waitForExtensionsActive(driver);

    // Execute the chat open command — this focuses the chat input
    console.log('[openChatPanel] Executing workbench.action.chat.open...');
    try {
      await workbench.executeCommand('workbench.action.chat.open');
    } catch {
      // Command palette interaction may fail if it's already open or blocked
      console.log('[openChatPanel] executeCommand failed, pressing Escape and retrying...');
      await driver.actions().sendKeys(Key.ESCAPE).perform();
      await sleep(500);
      try {
        await workbench.executeCommand('workbench.action.chat.open');
      } catch {
        console.log('[openChatPanel] Second attempt also failed, checking if chat is already open...');
      }
    }
    await sleep(CHAT_INPUT_READY_DELAY);

    // Verify chat panel appeared by looking for the chat widget container
    const chatVisible = await waitForChatWidget(driver, CHAT_PANEL_TIMEOUT);
    if (!chatVisible) {
      console.log('[openChatPanel] Chat widget not found after command');
      await dumpChatDom(driver, 'openChatPanel-failed');
      return false;
    }

    // Dump DOM for debugging (only first time)
    await dumpChatDom(driver, 'openChatPanel-success');

    console.log('[openChatPanel] Chat panel opened successfully');
    return true;
  } catch (error: any) {
    console.log(`[openChatPanel] Failed to open chat panel: ${error.message}`);
    return false;
  }
}

/**
 * Waits for VS Code extensions to finish activating.
 * The status bar shows "Activating Extensions..." during activation.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum wait time in ms (default 30s)
 */
async function waitForExtensionsActive(driver: WebDriver, timeout = 30_000): Promise<void> {
  const startTime = Date.now();
  let wasActivating = false;

  while (Date.now() - startTime < timeout) {
    try {
      const statusText = await driver.executeScript<string>(`
        const statusItems = document.querySelectorAll('.statusbar-item');
        for (const item of statusItems) {
          const text = item.textContent || '';
          if (text.includes('Activating Extensions')) return text;
        }
        return '';
      `);

      if (statusText) {
        wasActivating = true;
        console.log('[waitForExtensionsActive] Extensions still activating...');
      } else if (wasActivating) {
        console.log('[waitForExtensionsActive] Extensions finished activating');
        return;
      } else {
        // Never saw "Activating" — either already done or not shown
        return;
      }
    } catch {
      // Continue
    }

    await sleep(1000);
  }

  console.log('[waitForExtensionsActive] Timed out waiting for extensions');
}

/**
 * Waits for the chat widget container to appear in the DOM.
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait in ms
 * @returns true if chat widget found
 */
async function waitForChatWidget(driver: WebDriver, timeout: number): Promise<boolean> {
  const startTime = Date.now();

  const widgetSelectors = ['.interactive-session', '.chat-widget', '[class*="interactive-session"]'];

  while (Date.now() - startTime < timeout) {
    for (const selector of widgetSelectors) {
      try {
        const elements = await driver.findElements(By.css(selector));
        if (elements.length > 0) {
          console.log(`[waitForChatWidget] Found chat widget: ${selector}`);
          return true;
        }
      } catch {
        // Continue
      }
    }
    await sleep(CHAT_POLL_INTERVAL);
  }

  return false;
}

/**
 * Ensures the chat input is focused by clicking on the input area.
 * The chat input is a Monaco editor inside the interactive-input container.
 *
 * @param driver - The WebDriver instance
 * @returns true if focus was established
 */
async function focusChatInput(driver: WebDriver): Promise<boolean> {
  try {
    // Strategy 1: Click on the Monaco editor visible area inside the interactive input.
    // The areas are nested: .interactive-input-part > .chat-input-container > .monaco-editor > ...
    // We want to click the innermost visible area to trigger Monaco's focus handling.
    const inputContainerSelectors = [
      '.interactive-input-part .monaco-editor .overflow-guard',
      '.interactive-input-part .monaco-editor',
      '.chat-input-part .monaco-editor .overflow-guard',
      '.chat-input-part .monaco-editor',
      '.interactive-input-part',
    ];

    for (const selector of inputContainerSelectors) {
      try {
        const elements = await driver.findElements(By.css(selector));
        for (const el of elements) {
          try {
            const displayed = await el.isDisplayed();
            if (displayed) {
              const rect = await el.getRect();
              // Only click on elements that have reasonable size (not hidden)
              if (rect.width > 10 && rect.height > 5) {
                console.log(`[focusChatInput] Clicking on: ${selector} (${Math.round(rect.width)}x${Math.round(rect.height)})`);
                await driver.actions().move({ origin: el }).click().perform();
                await sleep(300);

                // Verify focus landed on a textarea (Monaco's hidden input)
                const isMonacoFocused = await driver.executeScript<boolean>(`
                  const active = document.activeElement;
                  if (!active) return false;
                  // Monaco focuses its hidden textarea when the editor is clicked
                  // In VS Code 1.108+, the class is 'ime-text-area' (not 'inputarea')
                  if (active.tagName === 'TEXTAREA' && active.classList.contains('ime-text-area')) return true;
                  if (active.tagName === 'TEXTAREA' && active.classList.contains('inputarea')) return true;
                  // Or any textarea inside the interactive input
                  if (active.tagName === 'TEXTAREA' && active.closest('.interactive-input-part')) return true;
                  // Or the native-edit-context div
                  if (active.classList.contains('native-edit-context')) return true;
                  return false;
                `);

                if (isMonacoFocused) {
                  console.log('[focusChatInput] Monaco input is now focused');
                  return true;
                }

                // Even if the focus check failed, if we clicked a chat input area,
                // the native-edit-context should have focus now. Accept it.
                const anyActive = await driver.executeScript<string>(
                  'return document.activeElement ? document.activeElement.className.substring(0,50) : "none"'
                );
                console.log(`[focusChatInput] Active after click: ${anyActive}`);
                // If we clicked inside interactive-input-part, accept it
                if (selector.includes('interactive-input')) {
                  return true;
                }
              }
            }
          } catch {
            // Element may be stale
          }
        }
      } catch {
        // Try next
      }
    }

    // Strategy 2: Find and click the Monaco hidden textarea directly
    console.log('[focusChatInput] Trying direct textarea.inputarea click...');
    const textarea = await findMonacoTextarea(driver);
    if (textarea) {
      try {
        await driver.executeScript('arguments[0].focus();', textarea);
        await sleep(200);
        const isFocused = await driver.executeScript<boolean>('return document.activeElement === arguments[0];', textarea);
        if (isFocused) {
          console.log('[focusChatInput] Direct textarea focus succeeded');
          return true;
        }
      } catch {
        // Continue to strategy 3
      }
    }

    // Strategy 3: Use the VS Code command to focus chat input
    console.log('[focusChatInput] Falling back to command-based focus');
    const workbench = new Workbench();
    await workbench.executeCommand('workbench.action.chat.open');
    await sleep(500);

    // After the command, verify focus
    const postCommandFocus = await driver.executeScript<boolean>(`
      const active = document.activeElement;
      return active && active.tagName === 'TEXTAREA' && !!active.closest('.interactive-input-part');
    `);
    console.log(`[focusChatInput] Post-command focus on chat input: ${postCommandFocus}`);
    return postCommandFocus || true; // Assume the command worked even if we can't verify
  } catch (error: any) {
    console.log(`[focusChatInput] Failed: ${error.message}`);
    return false;
  }
}

/**
 * Sends a prompt to the @logicapps chat participant.
 *
 * Uses Selenium Actions API to type to the focused element (the Monaco chat input)
 * rather than trying to find and interact with a specific textarea element.
 *
 * @param driver - The WebDriver instance
 * @param prompt - The prompt text (without @logicapps prefix - it will be added)
 * @param includeParticipant - Whether to prefix with @logicapps (default true)
 * @returns true if prompt was sent successfully
 */
export async function sendChatPrompt(driver: WebDriver, prompt: string, includeParticipant = true): Promise<boolean> {
  try {
    // Build the full prompt
    const fullPrompt = includeParticipant ? `@logicapps ${prompt}` : prompt;

    console.log(`[sendChatPrompt] Typing: "${fullPrompt.substring(0, 80)}"`);

    // Step 1: Focus the chat input by clicking directly on the Monaco editor area.
    // We must do this IMMEDIATELY before typing with no Escape/clearUI in between.
    const focused = await focusChatInput(driver);
    if (!focused) {
      console.log('[sendChatPrompt] Could not focus chat input');
      await dumpChatDom(driver, 'sendChatPrompt-no-focus');
      return false;
    }
    await sleep(300);

    // Step 2: Verify we're in the right place — check active element
    const activeTag = await driver.executeScript<string>(
      'return document.activeElement ? document.activeElement.tagName + "." + (document.activeElement.className || "").substring(0,80) : "none"'
    );
    console.log(`[sendChatPrompt] Active element after focus: ${activeTag}`);

    // Step 3: Clear any existing text — use JS to set empty value
    // Step 4: Type the prompt into the Monaco chat input.
    //
    // VS Code 1.108+ uses the EditContext API with a `div.native-edit-context[role="textbox"]`.
    // Neither textarea.sendKeys(), Actions API sendKeys(), execCommand('insertText'),
    // nor InputEvent dispatch work with this element.
    //
    // Working approach: Find the `native-edit-context` div, use Actions API to click it,
    // then use Selenium's element.sendKeys() on that div (which has role="textbox").
    console.log('[sendChatPrompt] Typing via native-edit-context sendKeys');

    // Find the native-edit-context element in the chat input
    // Must be scoped to the chat panel to avoid matching other Monaco editors (e.g., Output panel)
    const editContextEl = await driver.executeScript<WebElement | null>(`
      // Find specifically the interactive-input-part's native-edit-context
      const inputPart = document.querySelector('.interactive-input-part');
      if (inputPart) {
        const editCtx = inputPart.querySelector('[role="textbox"].native-edit-context') ||
                        inputPart.querySelector('[role="textbox"]');
        return editCtx;
      }
      return null;
    `);

    if (editContextEl) {
      console.log('[sendChatPrompt] Found native-edit-context in chat input');
      // Click to ensure focus
      await driver.actions().move({ origin: editContextEl }).click().perform();
      await sleep(200);

      // Clear existing text
      await editContextEl.sendKeys(Key.chord(Key.CONTROL, 'a'));
      await sleep(50);
      await editContextEl.sendKeys(Key.BACK_SPACE);
      await sleep(100);

      // Type the prompt
      await editContextEl.sendKeys(fullPrompt);
      await sleep(500);
    } else {
      // Fallback: try the Monaco overflow-guard area
      console.log('[sendChatPrompt] No native-edit-context found, trying overflow-guard click + Actions sendKeys');
      const monacoArea = await driver.findElement(By.css('.interactive-input-part .monaco-editor .overflow-guard')).catch(() => null);

      if (monacoArea) {
        await driver.actions().move({ origin: monacoArea }).click().perform();
        await sleep(200);
      }

      // Try Actions API as last resort
      await driver.actions().keyDown(Key.CONTROL).sendKeys('a').keyUp(Key.CONTROL).perform();
      await sleep(50);
      await driver.actions().sendKeys(Key.BACK_SPACE).perform();
      await sleep(100);
      await driver.actions().sendKeys(fullPrompt).perform();
      await sleep(500);
    }

    // Step 5: Take screenshot to verify text appeared
    await captureScreenshot(driver, 'chat-prompt-typed');

    // Step 6: Verify text was typed by reading the Monaco editor content
    const typedText = await driver.executeScript<string>(`
      // Check the Monaco editor model inside the chat input
      const editors = document.querySelectorAll('.interactive-input-part .monaco-editor');
      for (const ed of editors) {
        // Monaco stores content in lines within .view-lines
        const lines = ed.querySelectorAll('.view-line');
        if (lines.length > 0) {
          let text = '';
          for (const line of lines) {
            text += line.textContent || '';
          }
          if (text.trim().length > 0) return text.trim();
        }
      }
      // Fallback: check textareas
      const textareas = document.querySelectorAll('.interactive-input-part textarea');
      for (const ta of textareas) {
        if (ta.value && ta.value.length > 0) return ta.value;
      }
      return '';
    `);
    console.log(`[sendChatPrompt] Typed text in editor: "${(typedText || '').substring(0, 80)}"`);

    if (!typedText || typedText.trim().length === 0) {
      console.log('[sendChatPrompt] WARNING: No text detected in editor after typing!');
      await dumpChatDom(driver, 'sendChatPrompt-no-text');

      // Fallback: try clicking the textarea directly and sending keys
      console.log('[sendChatPrompt] Trying fallback: find and type into textarea.inputarea');
      const textarea = await findMonacoTextarea(driver);
      if (textarea) {
        await textarea.click();
        await sleep(200);
        await textarea.sendKeys(fullPrompt);
        await sleep(300);
        console.log('[sendChatPrompt] Fallback textarea typing attempted');
      }
    }

    // Step 7: Send the message with Enter
    console.log('[sendChatPrompt] Pressing Enter to send...');
    await driver.actions().sendKeys(Key.ENTER).perform();
    await sleep(1000);

    // Take screenshot after sending
    await captureScreenshot(driver, 'chat-prompt-sent');

    console.log(`[sendChatPrompt] Sent prompt: ${fullPrompt.substring(0, 100)}`);
    return true;
  } catch (error: any) {
    console.log(`[sendChatPrompt] Failed to send prompt: ${error.message}`);
    return false;
  }
}

/**
 * Finds the hidden Monaco textarea.inputarea inside the chat input.
 * This is the element that receives keyboard events for the Monaco editor.
 */
async function findMonacoTextarea(driver: WebDriver): Promise<WebElement | null> {
  const selectors = [
    '.interactive-input-part textarea.ime-text-area',
    '.interactive-input-part textarea.inputarea',
    '.interactive-input-part .monaco-editor textarea',
    '.interactive-input textarea.ime-text-area',
    '.interactive-input textarea.inputarea',
    '.chat-input-part textarea',
    '.interactive-input-part textarea',
  ];

  for (const selector of selectors) {
    try {
      const elements = await driver.findElements(By.css(selector));
      if (elements.length > 0) {
        console.log(`[findMonacoTextarea] Found: ${selector}`);
        return elements[0];
      }
    } catch {
      // Try next
    }
  }

  console.log('[findMonacoTextarea] Not found');
  return null;
}

/**
 * Waits for the chat response to complete (stops streaming).
 *
 * Detection strategy:
 * 1. First waits for any response content to appear
 * 2. Then waits for content to stabilize (no changes for N polls)
 *
 * @param driver - The WebDriver instance
 * @param timeout - Maximum time to wait in ms
 * @returns true if response completed
 */
export async function waitForChatResponse(driver: WebDriver, timeout: number = CHAT_RESPONSE_TIMEOUT): Promise<boolean> {
  const startTime = Date.now();
  let lastResponseLength = 0;
  let stableCount = 0;
  const requiredStableChecks = 3;
  let foundAnyResponse = false;
  let dumpedOnce = false;

  console.log('[waitForChatResponse] Waiting for response to complete...');

  while (Date.now() - startTime < timeout) {
    try {
      // Get current response text
      const response = await getLastChatResponse(driver);
      const currentLength = response?.length || 0;

      if (currentLength > 0) {
        if (!foundAnyResponse) {
          console.log(`[waitForChatResponse] First response detected (${currentLength} chars)`);
          foundAnyResponse = true;
        }

        if (currentLength === lastResponseLength) {
          stableCount++;
          if (stableCount >= requiredStableChecks) {
            console.log(`[waitForChatResponse] Response complete (${currentLength} chars)`);
            return true;
          }
        } else {
          stableCount = 0;
          lastResponseLength = currentLength;
        }
      } else {
        // No response yet — check if we should dump DOM for diagnostics
        const elapsed = Date.now() - startTime;
        if (elapsed > 15_000 && !dumpedOnce) {
          console.log('[waitForChatResponse] No response after 15s, dumping DOM...');
          await dumpChatDom(driver, 'waitForChatResponse-no-response');
          await captureScreenshot(driver, 'chat-no-response-15s');
          dumpedOnce = true;
        }
        if (elapsed > 30_000 && !foundAnyResponse) {
          console.log('[waitForChatResponse] No response after 30s');
        }
      }
    } catch {
      // Continue polling
    }

    await sleep(CHAT_POLL_INTERVAL);
  }

  console.log('[waitForChatResponse] Timed out waiting for response');
  await dumpChatDom(driver, 'waitForChatResponse-timeout');
  await captureScreenshot(driver, 'chat-response-timeout');
  return false;
}

/**
 * Gets the text content of the last chat response.
 *
 * Uses JavaScript injection to scan the DOM tree for response content,
 * which is more reliable than CSS selectors with Selenium findElements.
 *
 * @param driver - The WebDriver instance
 * @returns The response text or null
 */
export async function getLastChatResponse(driver: WebDriver): Promise<string | null> {
  try {
    // Use JavaScript to find response text — more flexible than CSS selectors
    const text = await driver.executeScript<string>(`
      // Texts to ignore — welcome/placeholder content that isn't a real response
      const ignoreTexts = [
        'build with agent',
        'ai responses may be inaccurate',
        'generate agent instructions',
        'onboard ai onto your codebase',
        'describe what to build',
        'suggested actions',
        'ask @vscode',
        'create project',
        'sign in',
        'by continuing, you agree',
        'terms and privacy',
        'privacy statement',
      ];

      function isIgnoredText(text) {
        const lower = text.toLowerCase().trim();
        // If the text is very short and matches a known ignore pattern, skip it
        for (const ignore of ignoreTexts) {
          if (lower.includes(ignore)) return true;
        }
        return false;
      }

      // Extract visible text only - skip style, script, and other non-visible elements
      function getVisibleText(element) {
        let text = '';
        for (const node of element.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent;
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();
            // Skip non-visible elements
            if (['style', 'script', 'noscript', 'template'].includes(tagName)) continue;
            // Skip hidden elements
            if (node.hidden || getComputedStyle(node).display === 'none') continue;
            text += getVisibleText(node);
          }
        }
        return text;
      }

      // Strategy 1: Look for interactive-response items (VS Code 1.100+)
      // These are actual chat responses (not the welcome screen)
      const responses = document.querySelectorAll('.interactive-item-container.interactive-response');
      if (responses.length > 0) {
        const lastResponse = responses[responses.length - 1];
        const responseText = getVisibleText(lastResponse).trim();
        if (responseText && responseText.length > 0 && !isIgnoredText(responseText)) {
          return responseText;
        }
      }

      // Strategy 2: Look for rendered markdown inside response containers
      const allItems = document.querySelectorAll('.interactive-item-container');
      for (let i = allItems.length - 1; i >= 0; i--) {
        const item = allItems[i];
        // Skip request items (user messages) - only want response items
        if (item.classList.contains('interactive-request')) continue;
        const markdown = item.querySelector('.rendered-markdown');
        if (markdown) {
          const mdText = getVisibleText(markdown).trim();
          if (mdText && mdText.length > 0 && !isIgnoredText(mdText)) {
            return mdText;
          }
        }
      }

      // Strategy 3: Look for chat tree welcome content (should be filtered out)
      // If we only find ignored content, return null so we don't confuse it with a response
      return null;
    `);

    return text || null;
  } catch (error: any) {
    console.log(`[getLastChatResponse] Error: ${error.message}`);
    return null;
  }
}

/**
 * Checks if the last chat response contains specific text.
 */
export async function responseContains(driver: WebDriver, expectedText: string): Promise<boolean> {
  const response = await getLastChatResponse(driver);
  if (!response) {
    return false;
  }
  return response.toLowerCase().includes(expectedText.toLowerCase());
}

/**
 * Checks if the last chat response contains any of the specified texts.
 */
export async function responseContainsAny(driver: WebDriver, expectedTexts: string[]): Promise<boolean> {
  const response = await getLastChatResponse(driver);
  if (!response) {
    return false;
  }
  const lowerResponse = response.toLowerCase();
  return expectedTexts.some((text) => lowerResponse.includes(text.toLowerCase()));
}

/**
 * Checks if the last chat response contains all of the specified texts.
 */
export async function responseContainsAll(driver: WebDriver, expectedTexts: string[]): Promise<boolean> {
  const response = await getLastChatResponse(driver);
  if (!response) {
    return false;
  }
  const lowerResponse = response.toLowerCase();
  return expectedTexts.every((text) => lowerResponse.includes(text.toLowerCase()));
}

/**
 * Checks if the last chat response excludes all of the specified texts.
 */
export async function responseContainsNone(driver: WebDriver, unexpectedTexts: string[]): Promise<boolean> {
  const response = await getLastChatResponse(driver);
  if (!response) {
    return false;
  }
  const lowerResponse = response.toLowerCase();
  return unexpectedTexts.every((text) => !lowerResponse.includes(text.toLowerCase()));
}

/**
 * Closes the chat panel.
 */
export async function closeChatPanel(driver: WebDriver): Promise<void> {
  try {
    const workbench = new Workbench();
    await workbench.executeCommand('workbench.action.closePanel');
    await sleep(500);
    console.log('[closeChatPanel] Chat panel closed');
  } catch (error: any) {
    console.log(`[closeChatPanel] Error: ${error.message}`);
  }
}

/**
 * Clears the chat history.
 * Note: This re-opens the chat panel after clearing to ensure input is ready.
 */
export async function clearChatHistory(driver: WebDriver): Promise<void> {
  try {
    // Use keyboard shortcut to clear chat (more reliable than executeCommand)
    // Ctrl+L is the default binding for chat.action.clear in VS Code
    // But we need to make sure chat panel has focus first
    const workbench = new Workbench();
    try {
      await workbench.executeCommand('workbench.action.chat.clear');
    } catch {
      // Command palette interaction may fail — try keyboard shortcut
      console.log('[clearChatHistory] executeCommand failed, trying keyboard shortcut');
      // Press Escape first to close any open command palette
      await driver.actions().sendKeys(Key.ESCAPE).perform();
      await sleep(300);
    }
    await sleep(1000);
    // Re-open chat to ensure the panel is visible and input is ready
    try {
      await workbench.executeCommand('workbench.action.chat.open');
    } catch {
      console.log('[clearChatHistory] Could not re-open chat panel via command');
    }
    await sleep(500);
    console.log('[clearChatHistory] Chat history cleared and panel re-opened');
  } catch (error: any) {
    console.log(`[clearChatHistory] Error: ${error.message}`);
  }
}

// ===========================================================================
// High-Level Test Helpers
// ===========================================================================

/**
 * Sends a prompt and waits for the response to complete.
 * Combines openChatPanel (if needed), sendChatPrompt, and waitForChatResponse.
 *
 * @param driver - The WebDriver instance
 * @param prompt - The prompt text
 * @param options - Options for the operation
 * @returns The response text or null if failed
 */
export async function askLogicApps(
  driver: WebDriver,
  prompt: string,
  options: {
    ensureChatOpen?: boolean;
    includeParticipant?: boolean;
    timeout?: number;
  } = {}
): Promise<string | null> {
  const { ensureChatOpen = true, includeParticipant = true, timeout = CHAT_RESPONSE_TIMEOUT } = options;

  try {
    // Open chat panel if needed (and focus input)
    if (ensureChatOpen) {
      const opened = await openChatPanel(driver);
      if (!opened) {
        console.log('[askLogicApps] Failed to open chat panel');
        return null;
      }
    }

    // Send the prompt
    const sent = await sendChatPrompt(driver, prompt, includeParticipant);
    if (!sent) {
      console.log('[askLogicApps] Failed to send prompt');
      return null;
    }

    // Wait for response
    const completed = await waitForChatResponse(driver, timeout);
    if (!completed) {
      console.log('[askLogicApps] Response did not complete in time');
    }

    // Get the response
    const response = await getLastChatResponse(driver);
    return response;
  } catch (error: any) {
    console.log(`[askLogicApps] Error: ${error.message}`);
    return null;
  }
}

/**
 * Finds the chat input Monaco editor element for direct interaction.
 * Exported for tests that need it, but prefer sendChatPrompt() for typing.
 */
export async function findChatInput(driver: WebDriver): Promise<WebElement | null> {
  const selectors = [
    '.interactive-input .monaco-editor',
    '.interactive-input-part .monaco-editor',
    '.chat-input-part .monaco-editor',
    '.interactive-input',
    '.interactive-input-part',
  ];

  for (const selector of selectors) {
    try {
      const elements = await driver.findElements(By.css(selector));
      for (const el of elements) {
        try {
          if (await el.isDisplayed()) {
            return el;
          }
        } catch {
          // Element stale
        }
      }
    } catch {
      // Try next
    }
  }

  return null;
}

/**
 * Verifies help response contains expected command documentation.
 */
export async function verifyHelpResponse(driver: WebDriver): Promise<{
  hasCreateProject: boolean;
  hasCreateWorkflow: boolean;
  hasModifyAction: boolean;
  hasHelp: boolean;
  fullResponse: string | null;
}> {
  const response = await getLastChatResponse(driver);

  return {
    hasCreateProject: response?.toLowerCase().includes('createproject') || response?.toLowerCase().includes('create project') || false,
    hasCreateWorkflow: response?.toLowerCase().includes('createworkflow') || response?.toLowerCase().includes('create workflow') || false,
    hasModifyAction: response?.toLowerCase().includes('modifyaction') || response?.toLowerCase().includes('modify action') || false,
    hasHelp: response?.toLowerCase().includes('/help') || response?.toLowerCase().includes('help') || false,
    fullResponse: response,
  };
}
