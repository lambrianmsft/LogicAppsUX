/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Field, Input, Button, Label, useId } from '@fluentui/react-components';
import type { InputOnChangeData } from '@fluentui/react-components';
import { VSCodeContext } from '../../../webviewCommunication';
import { useCreateWorkspaceStyles } from '../createWorkspaceStyles';
import type { RootState } from '../../../state/store';
import type { CreateWorkspaceState } from '../../../state/createWorkspace/createWorkspaceSlice';
import { setProjectPath } from '../../../state/createWorkspace/createWorkspaceSlice';
import { useContext } from 'react';
import { useIntl } from 'react-intl';
import { useSelector, useDispatch } from 'react-redux';
import { XLargeText } from '@microsoft/designer-ui';

export const FolderStep: React.FC = () => {
  const dispatch = useDispatch();
  const intl = useIntl();
  const vscode = useContext(VSCodeContext);
  const styles = useCreateWorkspaceStyles();
  const createWorkspaceState = useSelector((state: RootState) => state.createWorkspace) as CreateWorkspaceState;
  const { projectPath } = createWorkspaceState;
  const inputId = useId();

  const intlText = {
    TITLE: intl.formatMessage({
      defaultMessage: 'Select Project Folder',
      id: 'e5SSTH',
      description: 'Folder step title',
    }),
    DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Select the folder that will contain your logic app workspace',
      id: 'VsuK34',
      description: 'Folder step description',
    }),
    PROJECT_PATH_LABEL: intl.formatMessage({
      defaultMessage: 'Project Path',
      id: 'GrozSg',
      description: 'Project path input label',
    }),
    BROWSE_BUTTON: intl.formatMessage({
      defaultMessage: 'Browse...',
      id: 'cR0MlP',
      description: 'Browse folder button',
    }),
  };

  const handleProjectPathChange = (event: React.FormEvent<HTMLInputElement>, data: InputOnChangeData) => {
    dispatch(setProjectPath(data.value));
  };

  const handleBrowseFolder = () => {
    vscode.postMessage({
      command: 'select-folder',
      data: {},
    });
  };

  return (
    <div className={styles.formSection}>
      <XLargeText text={intlText.TITLE} className={styles.sectionTitle} style={{ display: 'block' }} />
      <div className={styles.fieldContainer}>
        <Field required>
          <Label htmlFor={inputId}>{intlText.PROJECT_PATH_LABEL}</Label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <Input
              id={inputId}
              value={projectPath}
              onChange={handleProjectPathChange}
              className={styles.inputControl}
              style={{
                flex: 1,
                minWidth: '300px', // Ensure minimum width for readability
                fontFamily: 'monospace', // Use monospace for better path readability
              }}
              title={projectPath} // Show full path on hover
            />
            <Button appearance="secondary" onClick={handleBrowseFolder}>
              {intlText.BROWSE_BUTTON}
            </Button>
          </div>
        </Field>
        {projectPath && <div className={styles.pathDisplay}>{projectPath}</div>}
      </div>
    </div>
  );
};
