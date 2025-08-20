/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Text } from '@fluentui/react-components';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../state/store';
import type { CreateWorkspaceState } from '../../../state/createWorkspace/createWorkspaceSlice';
import { useCreateWorkspaceStyles } from '../createWorkspaceStyles';
import {
  FolderStep,
  WorkspaceNameStep,
  LogicAppTypeStep,
  TargetFrameworkStep,
  LogicAppNameStep,
  ProjectTypeStep,
  OpenBehaviorStep,
} from './';
import { useIntl } from 'react-intl';

export const StepContent: React.FC = () => {
  const createWorkspaceState = useSelector((state: RootState) => state.createWorkspace) as CreateWorkspaceState;
  const { currentStep, isComplete } = createWorkspaceState;
  const styles = useCreateWorkspaceStyles();
  const intl = useIntl();

  const intlText = {
    WORKSPACE_CREATED: intl.formatMessage({
      defaultMessage: 'Workspace Created Successfully!',
      id: '4fdozy',
      description: 'Workspace creation success message',
    }),
    WORKSPACE_CREATED_DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Your logic app workspace has been created and is ready to use.',
      id: 'OdrYKo',
      description: 'Workspace creation success description',
    }),
  };

  if (isComplete) {
    return (
      <div className={styles.completionMessage}>
        <Text size={600} weight="semibold">
          {intlText.WORKSPACE_CREATED}
        </Text>
        <Text>{intlText.WORKSPACE_CREATED_DESCRIPTION}</Text>
      </div>
    );
  }

  switch (currentStep) {
    case 0:
      return <FolderStep />;
    case 1:
      return <WorkspaceNameStep />;
    case 2:
      return <LogicAppTypeStep />;
    case 3:
      return <TargetFrameworkStep />;
    case 4:
      return <LogicAppNameStep />;
    case 5:
      return <ProjectTypeStep />;
    case 6:
      return <OpenBehaviorStep />;
    default:
      return <FolderStep />;
  }
};
