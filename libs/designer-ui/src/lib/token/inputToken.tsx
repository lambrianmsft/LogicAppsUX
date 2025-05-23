import { TokenType } from '../editor';
import { CLOSE_TOKENPICKER } from '../editor/base/plugins/CloseTokenPicker';
import { DELETE_TOKEN_NODE } from '../editor/base/plugins/DeleteTokenNode';
import { OPEN_TOKEN_PICKER } from '../editor/base/plugins/OpenTokenPicker';
import iconSvg from './icon/icon.svg';
import { Icon, css } from '@fluentui/react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import { mergeRegister } from '@lexical/utils';
import { $getNodeByKey, BLUR_COMMAND, COMMAND_PRIORITY_EDITOR, FOCUS_COMMAND } from 'lexical';
import type { NodeKey } from 'lexical';
import type { TokenNode } from '../editor/base/nodes/tokenNode';
import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { getBrandColorWithOpacity } from '../card/utils';

export interface InputTokenProps {
  brandColor?: string;
  value?: string;
  disableFiltering?: boolean;
  icon?: string;
  isAdvanced?: boolean;
  isSecure?: boolean;
  readonly?: boolean;
  required?: boolean;
  title: string;
  nodeKey: NodeKey;
  description?: string;
}

export const DELETE = '\u00D7';
export const InputToken: React.FC<InputTokenProps> = ({ value, brandColor, icon, isSecure, readonly, title, nodeKey }) => {
  const [hasFocus, setFocus] = useState(true);
  const intl = useIntl();
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const tokenRef = useRef<null | HTMLDivElement>(null);

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        FOCUS_COMMAND,
        () => {
          setFocus(true);
          return false;
        },
        COMMAND_PRIORITY_EDITOR
      ),
      editor.registerCommand(
        BLUR_COMMAND,
        () => {
          setFocus(false);
          return false;
        },
        COMMAND_PRIORITY_EDITOR
      )
    );
  }, [editor]);

  const handleTokenClicked = (e: React.MouseEvent<HTMLSpanElement, MouseEvent>) => {
    if (!nodeKey) {
      return;
    }

    editor.getEditorState().read(() => {
      const node: TokenNode | null = $getNodeByKey(nodeKey);
      const token = node?.['__data']?.token;
      const tokenType = token?.tokenType;

      if (!token) {
        return;
      }

      if (!readonly && (tokenType === TokenType.FX || tokenType === TokenType.AGENTPARAMETER)) {
        editor.dispatchCommand(OPEN_TOKEN_PICKER, { token, nodeKey });
        return;
      }

      if (e.shiftKey) {
        setSelected(!isSelected);
      } else {
        clearSelection();
        setSelected(true);
        editor.dispatchCommand(CLOSE_TOKENPICKER, { focusEditorAfter: true });
      }

      editor.focus();
    });
  };

  const tokenStyle = {
    backgroundColor: brandColor ? getBrandColorWithOpacity(brandColor, 0.15) : 'rgba(71, 71, 71, 0.15)',
    backgroundImage: icon ?? `url(${iconSvg})`,
  };

  const tokenDelete = intl.formatMessage({
    defaultMessage: 'Delete',
    id: 'XqamWZ',
    description: 'Label of Delete Token Button',
  });

  const handleTokenDeleteClicked = () => {
    if (nodeKey) {
      editor.dispatchCommand(DELETE_TOKEN_NODE, nodeKey);
      editor.focus();
    }
  };

  const renderTokenDeleteButton = (): JSX.Element | null => {
    if (readonly) {
      return null;
    }

    return (
      <button
        title={tokenDelete}
        aria-label={tokenDelete}
        className="msla-button msla-token-delete"
        data-automation-id={`msla-token-delete-${title}`}
        onClick={(e) => {
          e.stopPropagation();
          handleTokenDeleteClicked();
        }}
        onMouseDown={(e) => {
          e.preventDefault();
        }}
      >
        {DELETE}
        {isSecure ? (
          <div className="msla-editor-input-secure-token">
            <Icon iconName="LockSolid" />
          </div>
        ) : null}
      </button>
    );
  };

  return (
    <span
      className={css('msla-token msla-input-token', isSelected && hasFocus && 'selected')}
      data-automation-id={`msla-token msla-input-token-${title}`}
      onClick={(e) => {
        handleTokenClicked(e);
        e.stopPropagation();
      }}
      title={value}
      style={tokenStyle}
      ref={tokenRef}
    >
      <div className="msla-token-title">{title}</div>
      {renderTokenDeleteButton()}
    </span>
  );
};
