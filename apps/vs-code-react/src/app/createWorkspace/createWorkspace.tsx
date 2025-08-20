import { XXLargeText, XLargeText, LargeText } from '@microsoft/designer-ui';
import type { OutletContext } from '../../run-service';
import { useCreateWorkspaceStyles } from './createWorkspaceStyles';
import { useIntl } from 'react-intl';
import { Outlet, useOutletContext } from 'react-router-dom';
import { FolderStep, WorkspaceNameStep, LogicAppTypeStep, TargetFrameworkStep, LogicAppNameStep, OpenBehaviorStep } from './steps/';
import { Button, Spinner } from '@fluentui/react-components';
import { VSCodeContext } from '../../webviewCommunication';
import type { RootState } from '../../state/store';
import type { CreateWorkspaceState } from '../../state/createWorkspace/createWorkspaceSlice';
import { setLoading, setError, setComplete } from '../../state/createWorkspace/createWorkspaceSlice';
import { useContext } from 'react';
import { useSelector, useDispatch } from 'react-redux';

export const CreateWorkspace: React.FC = () => {
  const workflowState = useSelector((state: RootState) => state.workflow);
  const intl = useIntl();
  const vscode = useContext(VSCodeContext);
  const dispatch = useDispatch();
  const styles = useCreateWorkspaceStyles();

  const createWorkspaceState = useSelector((state: RootState) => state.createWorkspace) as CreateWorkspaceState;
  const {
    isLoading,
    isComplete,
    error,
    projectPath,
    workspaceName,
    logicAppType,
    targetFramework,
    logicAppName,
    projectType,
    openBehavior,
  } = createWorkspaceState;

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

  const canCreate = () => {
    return (
      projectPath.trim() !== '' &&
      workspaceName.trim() !== '' &&
      logicAppType !== '' &&
      targetFramework !== '' &&
      logicAppName.trim() !== '' &&
      projectType !== '' &&
      openBehavior !== ''
    );
  };

  const handleCreate = async () => {
    if (!canCreate() || isLoading) {
      return;
    }

    dispatch(setLoading(true));
    dispatch(setError(undefined));

    try {
      const createWorkspaceData = {
        projectPath,
        workspaceName,
        logicAppType,
        targetFramework,
        logicAppName,
        projectType,
        openBehavior,
      };

      vscode.postMessage({
        command: 'createNewWorkspace',
        data: createWorkspaceData,
      });

      dispatch(setComplete(true));
    } catch (error) {
      dispatch(setError(error instanceof Error ? error.message : 'Failed to create workspace'));
    } finally {
      dispatch(setLoading(false));
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
      <XLargeText text={intlText.CREATE_WORKSPACE} className={styles.createWorkspaceTitle} style={{ display: 'block' }} />
      <LargeText text={intlText.CREATE_WORKSPACE} className={styles.createWorkspaceTitle} style={{ display: 'block' }} />
      <Outlet
        context={{
          baseUrl: workflowState.baseUrl,
          accessToken: workflowState.accessToken,
        }}
      />
      <FolderStep />

      <div className={styles.createWorkspaceContent}>
        <div className={styles.formGroup}>
          <FolderStep />
          <WorkspaceNameStep />
          <LogicAppTypeStep />
          <TargetFrameworkStep />
          <LogicAppNameStep />
          <OpenBehaviorStep />
        </div>

        {error && <div className={styles.errorMessage}>{error}</div>}

        <div className={styles.navigationContainer}>
          <div />
          <Button appearance="primary" onClick={handleCreate} disabled={!canCreate() || isLoading}>
            {isLoading ? (
              <div className={styles.loadingSpinner}>
                <Spinner size="tiny" />
                {intlText.CREATING}
              </div>
            ) : (
              intlText.CREATE_BUTTON
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export function useOutlet() {
  return useOutletContext<OutletContext>();
}
