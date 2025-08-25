/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { useCreateWorkspaceStyles } from '../createWorkspaceStyles';
import type { RootState } from '../../../state/store';
import type { CreateWorkspaceState } from '../../../state/createWorkspace/createWorkspaceSlice';
import { useIntl } from 'react-intl';
import { useSelector } from 'react-redux';
import { XLargeText, LargeText } from '@microsoft/designer-ui';

export const ReviewCreateStep: React.FC = () => {
  const intl = useIntl();
  const styles = useCreateWorkspaceStyles();
  const createWorkspaceState = useSelector((state: RootState) => state.createWorkspace) as CreateWorkspaceState;

  const {
    projectPath,
    workspaceName,
    logicAppType,
    dotNetFramework,
    functionWorkspace,
    functionName,
    workflowType,
    workflowName,
    targetFramework,
    logicAppName,
    projectType,
    openBehavior,
  } = createWorkspaceState;

  const needsDotNetFrameworkStep = logicAppType === 'customCode';

  const intlText = {
    TITLE: intl.formatMessage({
      defaultMessage: 'Review + Create',
      id: 'GH0CLv',
      description: 'Review and create step title',
    }),
    DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Review your configuration and create your Logic App workspace.',
      id: 'XepQZn',
      description: 'Review step description',
    }),
    PROJECT_SETUP: intl.formatMessage({
      defaultMessage: 'Project Setup',
      id: 'mAeD3g',
      description: 'Project setup section title',
    }),
    PROJECT_PATH_LABEL: intl.formatMessage({
      defaultMessage: 'Project Path',
      id: 'ff1WLC',
      description: 'Project path label',
    }),
    WORKSPACE_NAME_LABEL: intl.formatMessage({
      defaultMessage: 'Workspace Name',
      id: 'Jbo5DB',
      description: 'Workspace name label',
    }),
    WORKSPACE_FILE_LABEL: intl.formatMessage({
      defaultMessage: 'Workspace File',
      id: '+fM/eg',
      description: 'Workspace file path label',
    }),
    LOGIC_APP_TYPE_LABEL: intl.formatMessage({
      defaultMessage: 'Logic App Type',
      id: 'n/eWQU',
      description: 'Logic app type label',
    }),
    LOGIC_APP_NAME_LABEL: intl.formatMessage({
      defaultMessage: 'Logic App Name',
      id: 'i9+YCM',
      description: 'Logic app name label',
    }),
    DOTNET_FRAMEWORK_LABEL: intl.formatMessage({
      defaultMessage: '.NET Framework',
      id: 'kv8ROl',
      description: 'Dot net framework label',
    }),
    FUNCTION_WORKSPACE_LABEL: intl.formatMessage({
      defaultMessage: 'Function Workspace',
      id: 'aXShs8',
      description: 'Function workspace label',
    }),
    FUNCTION_NAME_LABEL: intl.formatMessage({
      defaultMessage: 'Function Name',
      id: '6I6s5I',
      description: 'Function name label',
    }),
    WORKFLOW_TYPE_LABEL: intl.formatMessage({
      defaultMessage: 'Workflow Type',
      id: 'JdYNQ+',
      description: 'Workflow type label',
    }),
    WORKFLOW_NAME_LABEL: intl.formatMessage({
      defaultMessage: 'Workflow Name',
      id: 'HC2d/m',
      description: 'Workflow name label',
    }),
    TARGET_FRAMEWORK_LABEL: intl.formatMessage({
      defaultMessage: 'Target Framework',
      id: 'abpttO',
      description: 'Target framework label',
    }),
    PROJECT_TYPE_LABEL: intl.formatMessage({
      defaultMessage: 'Project Type',
      id: 'c4XJJn',
      description: 'Project type label',
    }),
    OPEN_BEHAVIOR_LABEL: intl.formatMessage({
      defaultMessage: 'Open Behavior',
      id: 'ayJ1PC',
      description: 'Open behavior label',
    }),
    MISSING_VALUE: intl.formatMessage({
      defaultMessage: 'Not specified',
      id: 'KJLHaU',
      description: 'Missing value indicator',
    }),
  };

  const getWorkspaceFilePath = () => {
    if (!projectPath || !workspaceName) {
      return '';
    }
    return `${projectPath}\\${workspaceName}\\${workspaceName}.code-workspace`;
  };

  const getDotNetFrameworkDisplay = (framework: string) => {
    switch (framework) {
      case 'netFramework':
        return '.NET Framework';
      case 'net8':
        return '.NET 8';
      default:
        return framework;
    }
  };

  const getOpenBehaviorDisplay = (behavior: string) => {
    switch (behavior) {
      case 'openInCurrentWindow':
        return 'Open in current window';
      case 'openInNewWindow':
        return 'Open in new window';
      case 'addToWorkspace':
        return 'Add to workspace';
      default:
        return behavior;
    }
  };

  const getLogicAppTypeDisplay = (type: string) => {
    switch (type) {
      case 'standard':
        return 'Standard Logic App';
      case 'customCode':
        return 'Logic App with Custom Code';
      case 'rulesEngine':
        return 'Logic App with Rules Engine';
      default:
        return type || intlText.MISSING_VALUE;
    }
  };

  const getWorkflowTypeDisplay = (type: string) => {
    switch (type) {
      case 'Stateful':
        return 'Stateful';
      case 'Stateless':
        return 'Stateless';
      case 'AutonomousAgents':
        return 'Autonomous Agents (Preview)';
      default:
        return type || intlText.MISSING_VALUE;
    }
  };

  const renderSettingRow = (label: string, value: string, isRequired = true) => {
    const displayValue = value?.trim() || intlText.MISSING_VALUE;
    const isMissing = !value?.trim();

    return (
      <div className={styles.reviewRow} key={label}>
        <div className={styles.reviewLabel}>{label}:</div>
        <div className={`${styles.reviewValue} ${isMissing && isRequired ? styles.reviewValueMissing : ''}`}>{displayValue}</div>
      </div>
    );
  };

  return (
    <div className={styles.formSection}>
      <XLargeText text={intlText.TITLE} className={styles.sectionTitle} style={{ display: 'block' }} />
      <LargeText text={intlText.DESCRIPTION} className={styles.stepDescription} style={{ display: 'block' }} />

      <div className={styles.reviewContainer}>
        <div className={styles.reviewSection}>
          <div className={styles.reviewSectionTitle}>{intlText.PROJECT_SETUP}</div>
          {renderSettingRow(intlText.WORKSPACE_NAME_LABEL, workspaceName)}
          {renderSettingRow(intlText.WORKSPACE_FILE_LABEL, getWorkspaceFilePath())}
        </div>

        <div className={styles.reviewSection}>
          <div className={styles.reviewSectionTitle}>Logic App Details</div>
          {renderSettingRow(intlText.LOGIC_APP_NAME_LABEL, logicAppName)}
          {renderSettingRow(intlText.LOGIC_APP_TYPE_LABEL, getLogicAppTypeDisplay(logicAppType))}
        </div>

        {needsDotNetFrameworkStep && (
          <div className={styles.reviewSection}>
            <div className={styles.reviewSectionTitle}>Custom Code Configuration</div>
            {renderSettingRow(intlText.DOTNET_FRAMEWORK_LABEL, getDotNetFrameworkDisplay(dotNetFramework))}
            {renderSettingRow(intlText.FUNCTION_WORKSPACE_LABEL, functionWorkspace)}
            {renderSettingRow(intlText.FUNCTION_NAME_LABEL, functionName)}
          </div>
        )}

        <div className={styles.reviewSection}>
          <div className={styles.reviewSectionTitle}>Workflow Configuration</div>
          {renderSettingRow(intlText.WORKFLOW_NAME_LABEL, workflowName)}
          {renderSettingRow(intlText.WORKFLOW_TYPE_LABEL, getWorkflowTypeDisplay(workflowType))}
        </div>

        <div className={styles.reviewSection}>
          <div className={styles.reviewSectionTitle}>Additional Settings</div>
          {targetFramework && renderSettingRow(intlText.TARGET_FRAMEWORK_LABEL, targetFramework)}
          {projectType && renderSettingRow(intlText.PROJECT_TYPE_LABEL, projectType)}
          {renderSettingRow(intlText.OPEN_BEHAVIOR_LABEL, getOpenBehaviorDisplay(openBehavior))}
        </div>
      </div>
    </div>
  );
};
