import { TokenPickerMode } from '../../../../tokenpicker';
import type { IIconProps } from '@fluentui/react';
import { css, DirectionalHint, IconButton } from '@fluentui/react';
import { TooltipHost } from '@fluentui/react/lib/Tooltip';
import { Depths } from '@fluentui/theme';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { LogEntryLevel, LoggerService } from '@microsoft/logic-apps-shared';
import type { NodeKey } from 'lexical';
import { $getSelection } from 'lexical';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

const singleTokenHeightReduction = 15;

const dynamicContentIconProps: IIconProps = {
  iconName: 'LightningBolt',
};

const expressionButtonProps: IIconProps = {
  iconName: 'Variable',
};

export const TokenPickerButtonLocation = {
  Left: 'left',
  Right: 'right',
} as const;
export type TokenPickerButtonLocation = (typeof TokenPickerButtonLocation)[keyof typeof TokenPickerButtonLocation];

export interface hideButtonOptions {
  hideDynamicContent?: boolean;
  hideExpression?: boolean;
}

export interface TokenPickerButtonEditorProps {
  location?: TokenPickerButtonLocation;
  hideButtonOptions?: hideButtonOptions;
  verticalOffSet?: number;
  horizontalOffSet?: number;
  newlineVerticalOffset?: number;
  showAgentParameterButton?: boolean;
}

interface TokenPickerButtonProps extends TokenPickerButtonEditorProps {
  openTokenPicker: (mode: TokenPickerMode) => void;
}

export const TokenPickerButton = ({
  location = TokenPickerButtonLocation.Left,
  hideButtonOptions,
  verticalOffSet = 20,
  horizontalOffSet = 38,
  newlineVerticalOffset = 15,
  showAgentParameterButton,
  openTokenPicker,
}: TokenPickerButtonProps): JSX.Element => {
  const { hideDynamicContent, hideExpression } = hideButtonOptions ?? {};
  const intl = useIntl();
  const [editor] = useLexicalComposerContext();
  const [anchorKey, setAnchorKey] = useState<NodeKey | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const panel = document.getElementsByClassName('ms-Panel-scrollableContent')[0];

  const updateAnchorPoint = useCallback(() => {
    editor.getEditorState().read(() => {
      setAnchorKey($getSelection()?.getNodes()[0]?.__key ?? null);
    });
  }, [editor]);

  useEffect(() => {
    updateAnchorPoint();
  }, [editor, updateAnchorPoint]);

  const onChange = () => {
    updateAnchorPoint();
  };

  const updatePosition = useCallback(() => {
    if (anchorKey) {
      const boxElem = boxRef.current;
      const rootElement = editor.getRootElement();
      const anchorElement = editor.getElementByKey(anchorKey);

      if (boxElem && rootElement && anchorElement) {
        const { right, left } = rootElement.getBoundingClientRect();
        const { top } = anchorElement.getBoundingClientRect();
        const additionalOffset = hideExpression || hideDynamicContent ? singleTokenHeightReduction : 0;
        const shiftUpOffset = showAgentParameterButton ? 15 : 0; // Shift up by 30px if showAgentParameterButton is true

        if (anchorElement?.childNodes[0]?.nodeName === 'BR') {
          boxElem.style.top = `${top - newlineVerticalOffset + additionalOffset - shiftUpOffset}px`;
        } else {
          boxElem.style.top = `${top - verticalOffSet + additionalOffset - shiftUpOffset}px`;
        }

        if (location === TokenPickerButtonLocation.Right) {
          boxElem.style.left = `${right - 20}px`;
        } else {
          boxElem.style.left = `${left - horizontalOffSet}px`;
        }
      }
    }
  }, [
    anchorKey,
    editor,
    hideExpression,
    hideDynamicContent,
    location,
    newlineVerticalOffset,
    verticalOffSet,
    horizontalOffSet,
    showAgentParameterButton,
  ]);

  useEffect(() => {
    window.addEventListener('resize', updatePosition);
    panel?.addEventListener('scroll', updatePosition);

    return () => {
      window.removeEventListener('resize', updatePosition);
      panel?.removeEventListener('scroll', updatePosition);
    };
  }, [editor, updatePosition, panel]);

  useLayoutEffect(() => {
    updatePosition();
  }, [anchorKey, editor, updatePosition]);

  const dynamicContentButtonText = intl.formatMessage({
    defaultMessage: `Enter the data from previous step. You can also add data by typing the '/' character.`,
    id: 'p1IEXb',
    description: 'Label for button to open dynamic content token picker',
  });

  const expressionButtonText = intl.formatMessage({
    defaultMessage: `Insert expression (you can also add by typing '/' in the editor)`,
    id: '9V2Uwf',
    description: 'Label for button to open expression token picker',
  });

  const agentParameterButtonText = intl.formatMessage({
    defaultMessage: `Insert the agent parameter. You can also add by typing '/' in the editor.`,
    id: 'NfFrgQ',
    description: 'Button label for opening the agent parameter token picker',
  });

  return (
    <>
      {anchorKey ? (
        <div
          className={css('msla-token-picker-entrypoint-button-container')}
          ref={boxRef}
          onMouseDown={(e) => e.preventDefault()}
          style={{ boxShadow: Depths.depth4 }}
        >
          {hideDynamicContent ? null : (
            <TooltipHost content={dynamicContentButtonText}>
              <IconButton
                iconProps={dynamicContentIconProps}
                styles={{ root: `top-root-button-style ${hideExpression ? 'top-root-button-style-single' : ''}` }}
                className="msla-token-picker-entrypoint-button-dynamic-content"
                data-automation-id="msla-token-picker-entrypoint-button-dynamic-content"
                onClick={() => {
                  LoggerService().log({
                    area: 'TokenPickerButton:openTokenPicker',
                    args: [TokenPickerMode.TOKEN],
                    level: LogEntryLevel.Verbose,
                    message: 'Token picker opened.',
                  });
                  openTokenPicker(TokenPickerMode.TOKEN);
                }}
              />
            </TooltipHost>
          )}
          {hideExpression ? null : (
            <TooltipHost content={expressionButtonText} directionalHint={DirectionalHint.bottomCenter}>
              <IconButton
                iconProps={expressionButtonProps}
                styles={{
                  root: `${showAgentParameterButton ? 'middle-root-button-style' : 'bottom-root-button-style'} ${hideDynamicContent ? 'bottom-root-button-style-single' : ''}`,
                }}
                className="msla-token-picker-entrypoint-button-dynamic-content"
                data-automation-id="msla-token-picker-entrypoint-button-expression"
                onClick={() => {
                  LoggerService().log({
                    area: 'TokenPickerButton:openTokenPicker',
                    args: [TokenPickerMode.EXPRESSION],
                    level: LogEntryLevel.Verbose,
                    message: 'Expression picker opened.',
                  });
                  openTokenPicker(TokenPickerMode.EXPRESSION);
                }}
              />
            </TooltipHost>
          )}
          {showAgentParameterButton ? (
            <TooltipHost content={agentParameterButtonText}>
              <IconButton
                iconProps={{ iconName: 'Robot' }}
                styles={{ root: `bottom-root-button-style ${hideDynamicContent ? 'bottom-root-button-style-single' : ''}` }}
                className="msla-token-picker-entrypoint-button-dynamic-content"
                data-automation-id="msla-token-picker-entrypoint-button-agent-parameter"
                onClick={() => {
                  LoggerService().log({
                    area: 'TokenPickerButton:openTokenPicker',
                    args: [TokenPickerMode.AGENT_PARAMETER],
                    level: LogEntryLevel.Verbose,
                    message: 'Agent parameter picker opened.',
                  });
                  openTokenPicker(TokenPickerMode.AGENT_PARAMETER);
                }}
              />
            </TooltipHost>
          ) : null}
        </div>
      ) : null}
      <OnChangePlugin onChange={onChange} />
    </>
  );
};
