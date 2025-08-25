import { XXLargeText, XLargeText, LargeText } from '@microsoft/designer-ui';
import type { OutletContext } from '../../run-service';
import { useCreateWorkspaceStyles } from './createWorkspaceStyles';
import { useIntl } from 'react-intl';
import { useOutletContext } from 'react-router-dom';
import {
  FolderStep,
  WorkspaceNameStep,
  LogicAppTypeStep,
  DotNetFrameworkStep,
  WorkflowTypeStep,
  OpenBehaviorStep,
  ReviewCreateStep,
} from './steps/';
import { Button, Spinner } from '@fluentui/react-components';
import { VSCodeContext } from '../../webviewCommunication';
import type { RootState } from '../../state/store';
import type { CreateWorkspaceState } from '../../state/createWorkspace/createWorkspaceSlice';
import {
  // setLoading,
  // setError,
  // setComplete,
  nextStep,
  previousStep,
  setCurrentStep,
} from '../../state/createWorkspace/createWorkspaceSlice';
import { useContext } from 'react';
import { useSelector, useDispatch } from 'react-redux';

export const CreateWorkspace: React.FC = () => {
  const intl = useIntl();
  const vscode = useContext(VSCodeContext);
  const dispatch = useDispatch();
  const styles = useCreateWorkspaceStyles();

  const createWorkspaceState = useSelector((state: RootState) => state.createWorkspace) as CreateWorkspaceState;
  const {
    currentStep,
    isLoading,
    isComplete,
    error,
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

  // Determine if we need the .NET Framework step (only for custom code)
  const needsDotNetFrameworkStep = logicAppType === 'customCode';

  // Calculate total steps dynamically based on logic app type
  const totalSteps = needsDotNetFrameworkStep ? 6 : 5; // Added review step
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === totalSteps - 1;

  const intlText = {
    CREATE_WORKSPACE: intl.formatMessage({
      defaultMessage: 'Create logic app workspace',
      id: 'eagv8j',
      description: 'Create logic app workspace text.',
    }),
    CREATE_BUTTON: intl.formatMessage({
      defaultMessage: 'Create Workspace',
      id: 'XZfauP',
      description: 'Create workspace button',
    }),
    CREATING: intl.formatMessage({
      defaultMessage: 'Creating...',
      id: 'k6MqI+',
      description: 'Creating workspace in progress',
    }),
    NEXT: intl.formatMessage({
      defaultMessage: 'Next',
      id: '3Wcqsy',
      description: 'Next button',
    }),
    BACK: intl.formatMessage({
      defaultMessage: 'Back',
      id: '2XH9oW',
      description: 'Back button',
    }),
    STEP_INDICATOR: intl.formatMessage(
      {
        defaultMessage: 'Step {current} of {total}',
        id: '4IV3/7',
        description: 'Step indicator text',
      },
      {
        current: currentStep + 1,
        total: totalSteps,
      }
    ),
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
    // Step labels
    STEP_PROJECT_SETUP: intl.formatMessage({
      defaultMessage: 'Project Setup',
      id: '1d8W/S',
      description: 'Project setup step label',
    }),
    STEP_LOGIC_APP_TYPE: intl.formatMessage({
      defaultMessage: 'Logic App Details',
      id: 'IQ6azH',
      description: 'Logic app type and name step label',
    }),
    STEP_DOTNET_CONFIG: intl.formatMessage({
      defaultMessage: 'Custom Code Config',
      id: 'AeB9BS',
      description: 'Custom code configuration step label',
    }),
    STEP_WORKFLOW_CONFIG: intl.formatMessage({
      defaultMessage: 'Workflow Config',
      id: 'YzQPvP',
      description: 'Workflow configuration step label',
    }),
    STEP_FINAL_SETTINGS: intl.formatMessage({
      defaultMessage: 'Final Settings',
      id: 'pdL/41',
      description: 'Final settings step label',
    }),
    STEP_REVIEW_CREATE: intl.formatMessage({
      defaultMessage: 'Review + Create',
      id: '4dze5/',
      description: 'Review and create step label',
    }),
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0: // Folder and Workspace Name (combined)
        return projectPath.trim() !== '' && workspaceName.trim() !== '';
      case 1: // Logic App Type and Logic App Name
        return logicAppType !== '' && logicAppName.trim() !== '';
      case 2: {
        // If custom code is selected, validate .NET Framework step
        // Otherwise, validate WorkflowTypeStep (workflow type and workflow name)
        if (needsDotNetFrameworkStep) {
          return dotNetFramework !== '' && functionWorkspace.trim() !== '' && functionName.trim() !== '';
        }
        return workflowType !== '' && workflowName.trim() !== '';
      }
      case 3: {
        // If custom code is selected, validate WorkflowTypeStep here (workflow type and workflow name)
        // Otherwise, validate OpenBehaviorStep
        if (needsDotNetFrameworkStep) {
          return workflowType !== '' && workflowName.trim() !== '';
        }
        return openBehavior !== '';
      }
      case 4: {
        if (needsDotNetFrameworkStep) {
          // For custom code - validate OpenBehaviorStep
          return openBehavior !== '';
        }
        // For standard - this is the review step, validate all fields
        return (
          projectPath.trim() !== '' &&
          workspaceName.trim() !== '' &&
          logicAppType !== '' &&
          workflowType !== '' &&
          workflowName.trim() !== '' &&
          logicAppName.trim() !== '' &&
          openBehavior !== ''
        );
      }
      case 5: // Review step for custom code - validate all fields
        return (
          projectPath.trim() !== '' &&
          workspaceName.trim() !== '' &&
          logicAppType !== '' &&
          dotNetFramework !== '' &&
          functionWorkspace.trim() !== '' &&
          functionName.trim() !== '' &&
          workflowType !== '' &&
          workflowName.trim() !== '' &&
          logicAppName.trim() !== '' &&
          openBehavior !== ''
        );
      default:
        return false;
    }
  };

  // const canCreate = () => {
  //   const baseValidation = (
  //     projectPath.trim() !== '' &&
  //     workspaceName.trim() !== '' &&
  //     logicAppType !== '' &&
  //     workflowType !== '' &&
  //     targetFramework !== '' &&
  //     logicAppName.trim() !== '' &&
  //     projectType !== '' &&
  //     openBehavior !== ''
  //   );

  //   // If custom code is selected, also validate .NET Framework fields
  //   if (needsDotNetFrameworkStep) {
  //     return baseValidation &&
  //       dotNetFramework !== '' &&
  //       functionWorkspace.trim() !== '' &&
  //       functionName.trim() !== '';
  //   }

  //   return baseValidation;
  // };

  const getStepLabels = () => {
    if (needsDotNetFrameworkStep) {
      return [
        intlText.STEP_PROJECT_SETUP,
        intlText.STEP_LOGIC_APP_TYPE,
        intlText.STEP_DOTNET_CONFIG,
        intlText.STEP_WORKFLOW_CONFIG,
        intlText.STEP_FINAL_SETTINGS,
        intlText.STEP_REVIEW_CREATE,
      ];
    }
    return [
      intlText.STEP_PROJECT_SETUP,
      intlText.STEP_LOGIC_APP_TYPE,
      intlText.STEP_WORKFLOW_CONFIG,
      intlText.STEP_FINAL_SETTINGS,
      intlText.STEP_REVIEW_CREATE,
    ];
  };

  const isStepCompleted = (stepIndex: number) => {
    switch (stepIndex) {
      case 0:
        return projectPath.trim() !== '' && workspaceName.trim() !== '';
      case 1:
        return logicAppType !== '' && logicAppName.trim() !== '';
      case 2: {
        if (needsDotNetFrameworkStep) {
          return dotNetFramework !== '' && functionWorkspace.trim() !== '' && functionName.trim() !== '';
        }
        return workflowType !== '' && workflowName.trim() !== '';
      }
      case 3: {
        if (needsDotNetFrameworkStep) {
          return workflowType !== '' && workflowName.trim() !== '';
        }
        return openBehavior !== '';
      }
      case 4: {
        if (needsDotNetFrameworkStep) {
          return openBehavior !== '';
        }
        // For standard - this is the review step, validate all required fields
        return (
          projectPath.trim() !== '' &&
          workspaceName.trim() !== '' &&
          logicAppType !== '' &&
          workflowType !== '' &&
          workflowName.trim() !== '' &&
          logicAppName.trim() !== '' &&
          openBehavior !== ''
        );
      }
      case 5: // Review step for custom code
        return (
          projectPath.trim() !== '' &&
          workspaceName.trim() !== '' &&
          logicAppType !== '' &&
          dotNetFramework !== '' &&
          functionWorkspace.trim() !== '' &&
          functionName.trim() !== '' &&
          workflowType !== '' &&
          workflowName.trim() !== '' &&
          logicAppName.trim() !== '' &&
          openBehavior !== ''
        );
      default:
        return false;
    }
  };

  const canNavigateToStep = (stepIndex: number) => {
    // Can always navigate to current or previous steps
    if (stepIndex <= currentStep) {
      return true;
    }

    // For future steps, check if all intermediate steps can be completed
    for (let i = currentStep; i < stepIndex; i++) {
      if (!isStepCompleted(i)) {
        return false;
      }
    }

    return true;
  };

  const handleStepClick = (stepIndex: number) => {
    if (canNavigateToStep(stepIndex) && !isLoading) {
      dispatch(setCurrentStep(stepIndex));
    }
  };

  const renderStepNavigation = () => {
    const stepLabels = getStepLabels();

    return (
      <div className={styles.stepNavigation}>
        {stepLabels.map((label, index) => {
          const isActive = index === currentStep;
          const isCompleted = isStepCompleted(index);
          const canNavigate = canNavigateToStep(index);

          return (
            <div key={index} style={{ display: 'flex', alignItems: 'center' }}>
              <div
                className={`${styles.stepItem} ${isActive ? styles.stepItemActive : ''} ${canNavigate ? '' : styles.stepItemDisabled}`}
                onClick={() => handleStepClick(index)}
              >
                <div className={`${styles.stepNumber} ${isActive ? styles.stepNumberActive : ''}`}>
                  {isCompleted && !isActive ? '✓' : index + 1}
                </div>
                <div className={styles.stepLabel}>{label}</div>
              </div>
              {index < stepLabels.length - 1 && (
                <div className={`${styles.stepConnector} ${isCompleted ? styles.stepConnectorCompleted : ''}`} />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const handleBack = () => {
    if (!isFirstStep && !isLoading) {
      dispatch(previousStep());
    }
  };

  const handleNext = () => {
    if (canProceed() && !isLoading) {
      dispatch(nextStep());
    }
  };

  const handleCreate = () => {
    const data = {
      projectPath,
      workspaceName,
      logicAppType,
      workflowType,
      targetFramework,
      logicAppName,
      projectType,
      openBehavior,
      ...(needsDotNetFrameworkStep && {
        dotNetFramework,
        functionWorkspace,
        functionName,
      }),
    };
    vscode.postMessage({ command: 'createWorkspace', data });
  };

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <div>
            <FolderStep />
            <WorkspaceNameStep />
          </div>
        );
      case 1:
        return <LogicAppTypeStep />;
      case 2: {
        // If custom code is selected, show .NET Framework step
        // Otherwise, show WorkflowTypeStep
        if (needsDotNetFrameworkStep) {
          return <DotNetFrameworkStep />;
        }
        return <WorkflowTypeStep />;
      }
      case 3: {
        // If custom code is selected, show WorkflowTypeStep here
        // Otherwise, show OpenBehaviorStep
        if (needsDotNetFrameworkStep) {
          return <WorkflowTypeStep />;
        }
        return <OpenBehaviorStep />;
      }
      case 4: {
        if (needsDotNetFrameworkStep) {
          return <OpenBehaviorStep />;
        }
        return <ReviewCreateStep />;
      }
      case 5:
        return <ReviewCreateStep />;
      default:
        return (
          <div>
            <FolderStep />
            <WorkspaceNameStep />
          </div>
        );
    }
  };

  if (isComplete) {
    return (
      <div className={styles.createWorkspaceContainer}>
        <div className={styles.completionMessage}>
          <XLargeText text={intlText.WORKSPACE_CREATED} style={{ display: 'block' }} />
          <LargeText text={intlText.WORKSPACE_CREATED_DESCRIPTION} style={{ display: 'block' }} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.createWorkspaceContainer}>
      <XXLargeText text={intlText.CREATE_WORKSPACE} className={styles.createWorkspaceTitle} style={{ display: 'block' }} />

      {renderStepNavigation()}

      <div className={styles.createWorkspaceContent}>
        {renderCurrentStep()}

        {error && <div className={styles.errorMessage}>{error}</div>}
      </div>

      <div className={styles.navigationContainer}>
        <div className={styles.navigationLeft}>
          <span className={styles.stepIndicator}>{intlText.STEP_INDICATOR}</span>
        </div>
        <div className={styles.navigationRight}>
          <Button appearance="secondary" onClick={handleBack} disabled={isFirstStep || isLoading}>
            {intlText.BACK}
          </Button>
          {isLastStep ? (
            <Button appearance="primary" onClick={handleCreate} disabled={!canProceed() || isLoading}>
              {isLoading ? (
                <div className={styles.loadingSpinner}>
                  <Spinner size="tiny" />
                  {intlText.CREATING}
                </div>
              ) : (
                intlText.CREATE_BUTTON
              )}
            </Button>
          ) : (
            <Button appearance="primary" onClick={handleNext} disabled={!canProceed() || isLoading}>
              {intlText.NEXT}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export function useOutlet() {
  return useOutletContext<OutletContext>();
}
