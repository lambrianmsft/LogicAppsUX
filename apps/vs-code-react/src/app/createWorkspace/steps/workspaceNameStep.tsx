/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Field, Input, Label, useId } from '@fluentui/react-components';
import type { InputOnChangeData } from '@fluentui/react-components';
import { useCreateWorkspaceStyles } from '../createWorkspaceStyles';
import type { RootState } from '../../../state/store';
import type { CreateWorkspaceState } from '../../../state/createWorkspace/createWorkspaceSlice';
import { setWorkspaceName } from '../../../state/createWorkspace/createWorkspaceSlice';
import { useIntl } from 'react-intl';
import { useSelector, useDispatch } from 'react-redux';
import { XLargeText } from '@microsoft/designer-ui';

export const WorkspaceNameStep: React.FC = () => {
  const dispatch = useDispatch();
  const intl = useIntl();
  const styles = useCreateWorkspaceStyles();
  const createWorkspaceState = useSelector((state: RootState) => state.createWorkspace) as CreateWorkspaceState;
  const { workspaceName } = createWorkspaceState;
  const inputId = useId();

  const intlText = {
    TITLE: intl.formatMessage({
      defaultMessage: 'Workspace Name',
      id: 'FKhiqh',
      description: 'Workspace name step title',
    }),
    DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Enter a name for your logic app workspace',
      id: '/wy7/B',
      description: 'Workspace name step description',
    }),
    WORKSPACE_NAME_LABEL: intl.formatMessage({
      defaultMessage: 'Workspace Name',
      id: 'uNvoPg',
      description: 'Workspace name input label',
    }),
  };

  const handleWorkspaceNameChange = (event: React.FormEvent<HTMLInputElement>, data: InputOnChangeData) => {
    dispatch(setWorkspaceName(data.value));
  };

  return (
    <div className={styles.formSection}>
      <XLargeText text={intlText.TITLE} className={styles.sectionTitle} style={{ display: 'block' }} />
      <div className={styles.fieldContainer}>
        <Field required>
          <Label htmlFor={inputId}>{intlText.WORKSPACE_NAME_LABEL}</Label>
          <Input id={inputId} value={workspaceName} onChange={handleWorkspaceNameChange} className={styles.inputControl} />
        </Field>
      </div>
    </div>
  );
};
