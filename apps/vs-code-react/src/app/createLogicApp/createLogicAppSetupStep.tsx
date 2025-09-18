/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type React from 'react';
import { useCreateWorkspaceStyles } from '../createWorkspace/createWorkspaceStyles';
import { LogicAppTypeStep } from '../createWorkspace/steps/logicAppTypeStep';
import { WorkflowTypeStepAlt } from '../createWorkspace/steps/workflowTypeStepAlt';
import { DotNetFrameworkStep } from '../createWorkspace/steps/dotNetFrameworkStep';

export const CreateLogicAppSetupStep: React.FC = () => {
  const styles = useCreateWorkspaceStyles();

  return (
    <div className={styles.formSection}>
      <LogicAppTypeStep />
      <DotNetFrameworkStep />
      <WorkflowTypeStepAlt />
    </div>
  );
};
