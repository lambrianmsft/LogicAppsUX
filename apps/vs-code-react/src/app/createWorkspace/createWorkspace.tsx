import { XXLargeText, XLargeText, LargeText } from '@microsoft/designer-ui';
import type { OutletContext } from '../../run-service';
import { useCreateWorkspaceStyles } from './createWorkspaceStyles';
import { useIntl } from 'react-intl';
import { useOutletContext } from 'react-router-dom';
import { FolderStep, WorkspaceNameStep, LogicAppTypeStep, DotNetFrameworkStep, WorkflowTypeStep, OpenBehaviorStep } from './steps/';
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
    targetFramework,
    logicAppName,
    projectType,
    openBehavior,
  } = createWorkspaceState;

  // Determine if we need the .NET Framework step (only for custom code)
  const needsDotNetFrameworkStep = logicAppType === 'customCode';

  // Calculate total steps dynamically based on logic app type
  const totalSteps = needsDotNetFrameworkStep ? 5 : 4;
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
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0: // Folder and Workspace Name (combined)
        return projectPath.trim() !== '' && workspaceName.trim() !== '';
      case 1: // Logic App Type
        return logicAppType !== '';
      case 2: {
        // If custom code is selected, validate .NET Framework step
        // Otherwise, validate WorkflowTypeStep (includes workflow name)
        if (needsDotNetFrameworkStep) {
          return dotNetFramework !== '' && functionWorkspace.trim() !== '' && functionName.trim() !== '';
        }
        return workflowType !== '' && logicAppName.trim() !== '';
      }
      case 3: {
        // If custom code is selected, validate WorkflowTypeStep here (includes workflow name)
        // Otherwise, validate TargetFrameworkStep
        if (needsDotNetFrameworkStep) {
          return workflowType !== '' && logicAppName.trim() !== '';
        }
        return targetFramework !== '';
      }
      case 4: // Only for custom code - validate OpenBehaviorStep
        return openBehavior !== '';
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
        // Otherwise, show TargetFrameworkStep
        if (needsDotNetFrameworkStep) {
          return <WorkflowTypeStep />;
        }
        return <OpenBehaviorStep />;
      }
      case 4:
        // Only for custom code - show OpenBehaviorStep
        return <OpenBehaviorStep />;
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
