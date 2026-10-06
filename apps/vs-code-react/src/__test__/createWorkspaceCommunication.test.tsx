import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore, type AnyAction } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtensionCommand, ProjectName, ProjectType } from '@microsoft/vscode-extension-logic-apps';
import { createWorkspaceSlice, type CreateWorkspaceState } from '../state/createWorkspaceSlice';
import { projectSlice } from '../state/projectSlice';
import type { CreateWorkspaceFailureMessage, ValidateWorkspacePathMessage } from '../run-service/types';
import {
  CreateLogicApp,
  CreateWorkflow,
  CreateWorkspace,
  CreateWorkspaceFromPackage,
  CreateWorkspaceStructure,
} from '../app/createWorkspace/createWorkspace';
import { WebViewCommunication } from '../webviewCommunication';

const { postMessage } = vi.hoisted(() => {
  const postMessage = vi.fn();
  vi.stubGlobal('acquireVsCodeApi', () => ({ postMessage }));
  return { postMessage };
});

vi.mock('@microsoft/logic-apps-designer', () => ({
  store: { dispatch: vi.fn() },
  resetDesignerDirtyState: vi.fn(),
}));

vi.mock('../app/createWorkspace/createWorkspaceStyles', () => ({
  useCreateWorkspaceStyles: () => ({}),
}));

vi.mock('../app/createWorkspace/steps/', async () => {
  const { WorkspaceNameStep } = await import('../app/createWorkspace/steps/workspaceNameStep');
  return {
    WorkspaceNameStep,
    ProjectSetupStep: WorkspaceNameStep,
    PackageSetupStep: WorkspaceNameStep,
    ReviewCreateStep: () => <div>Review</div>,
  };
});

vi.mock('../app/createLogicApp/createLogicAppSetupStep', () => ({
  CreateLogicAppSetupStep: () => <div>Logic app setup</div>,
}));

const parentPath = 'D:\\workspacetest';
const workspaceName = 'my-workspace';
const actionableError = 'Select a workspace folder under D:\\candidate\\workspace.';
const replaceState = 'test/replaceCreateWorkspaceState';

const renderWizard = (
  project = ProjectName.createWorkspace,
  Component = CreateWorkspace,
  overrides: Partial<CreateWorkspaceState> = {}
) => {
  const store = configureStore({
    reducer: {
      project: projectSlice.reducer,
      createWorkspace: (state: CreateWorkspaceState | undefined, action: AnyAction) =>
        action.type === replaceState ? (action.payload as CreateWorkspaceState) : createWorkspaceSlice.reducer(state, action),
    },
    preloadedState: {
      project: { initialized: true, project },
      createWorkspace: { ...createWorkspaceSlice.getInitialState(), separator: '\\' },
    },
  });
  render(
    <Provider store={store}>
      <WebViewCommunication>
        <Component />
      </WebViewCommunication>
    </Provider>
  );
  act(() => {
    store.dispatch({
      type: replaceState,
      payload: {
        ...store.getState().createWorkspace,
        currentStep: 1,
        workspaceProjectPath: { fsPath: parentPath, path: parentPath },
        workspaceName,
        logicAppType: ProjectType.logicApp,
        logicAppName: 'my-app',
        workflowName: 'my-workflow',
        workflowType: 'Stateful-Codeless',
        packagePath: { fsPath: 'D:\\package.zip', path: 'D:\\package.zip' },
        packageValidationResults: { 'D:\\package.zip': true },
        pathValidationResults: { [parentPath]: true },
        workspaceExistenceResults: {
          [`${parentPath}\\${workspaceName}`]: false,
          [`${parentPath}\\${workspaceName}\\${workspaceName}.code-workspace`]: false,
        },
        separator: '\\',
        ...overrides,
      },
    });
  });
  return store;
};

const receive = (message: CreateWorkspaceFailureMessage | ValidateWorkspacePathMessage) => {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  });
};

describe('create wizard host responses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [ProjectName.createWorkspace, ExtensionCommand.createWorkspace, CreateWorkspace],
    [ProjectName.createWorkspaceFromPackage, ExtensionCommand.createWorkspaceFromPackage, CreateWorkspaceFromPackage],
    [ProjectName.createWorkspaceStructure, ExtensionCommand.createWorkspaceStructure, CreateWorkspaceStructure],
    [ProjectName.createLogicApp, ExtensionCommand.createLogicApp, CreateLogicApp],
    [ProjectName.createWorkflow, ExtensionCommand.createWorkflow, CreateWorkflow],
  ])('recovers %s from a received failure and retries with preserved fields', (project, command, Component) => {
    const store = renderWizard(project, Component);
    const before = store.getState().createWorkspace;
    const createButton = screen.getByRole('button', { name: /^Create/ });
    const backButton = screen.getByRole('button', { name: 'Back' });

    fireEvent.click(createButton);
    expect(store.getState().createWorkspace.isLoading).toBe(true);
    expect(createButton).toBeDisabled();
    expect(backButton).toBeDisabled();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    const firstRequest = postMessage.mock.calls.find(([message]) => message.command === command)?.[0];
    expect(firstRequest).toBeDefined();

    receive({ command, data: { project, error: actionableError } });
    expect(screen.getByText(actionableError)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(createButton).toBeEnabled();
    expect(backButton).toBeEnabled();
    expect(store.getState().createWorkspace).toEqual({ ...before, error: actionableError, isLoading: false });

    fireEvent.click(createButton);
    expect(screen.queryByText(actionableError)).not.toBeInTheDocument();
    expect(store.getState().createWorkspace.isLoading).toBe(true);
    expect(store.getState().createWorkspace.error).toBeUndefined();
    const requests = postMessage.mock.calls.filter(([message]) => message.command === command);
    expect(requests).toHaveLength(2);
    expect(requests[1][0].data).toEqual(firstRequest.data);
  });

  it('shows the host path error, blocks Next, and clears the error after successful revalidation', async () => {
    const store = renderWizard(ProjectName.createWorkspace, CreateWorkspace, { currentStep: 0 });
    const nextButton = screen.getByRole('button', { name: 'Next' });
    expect(nextButton).toBeEnabled();

    receive({
      command: ExtensionCommand.validatePath,
      data: { project: ProjectName.createWorkspace, path: parentPath, isValid: false, error: actionableError },
    });
    expect(nextButton).toBeDisabled();
    await waitFor(() => expect(screen.getByText(actionableError)).toBeInTheDocument());
    expect(screen.queryByText('The specified path does not exist or is not accessible.')).not.toBeInTheDocument();
    fireEvent.click(nextButton);
    expect(store.getState().createWorkspace.currentStep).toBe(0);

    receive({
      command: ExtensionCommand.validatePath,
      data: { project: ProjectName.createWorkspace, path: parentPath, isValid: true },
    });
    await waitFor(() => expect(screen.queryByText(actionableError)).not.toBeInTheDocument());
    expect(nextButton).toBeEnabled();
    expect(store.getState().createWorkspace.pathValidationErrors?.[parentPath]).toBeUndefined();
  });

  it('keeps the existing path-not-found message for validation replies without a host error', async () => {
    renderWizard(ProjectName.createWorkspace, CreateWorkspace, { currentStep: 0 });
    receive({
      command: ExtensionCommand.validatePath,
      data: { path: parentPath, isValid: false },
    });
    await waitFor(() => expect(screen.getByText('The specified path does not exist or is not accessible.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});
