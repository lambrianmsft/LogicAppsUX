/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ITargetDirectory } from 'run-service';

export interface CreateWorkspaceState {
  currentStep: number;
  workspaceProjectPath: ITargetDirectory;
  workspaceName: string;
  logicAppType: string;
  functionWorkspace: string;
  functionName: string;
  workflowType: string;
  workflowName: string;
  targetFramework: string;
  logicAppName: string;
  projectType: string;
  openBehavior: string;
  isLoading: boolean;
  error?: string;
  isComplete: boolean;
}

const initialState: CreateWorkspaceState = {
  currentStep: 0,
  workspaceProjectPath: {
    fsPath: '',
    path: '',
  },
  workspaceName: '',
  logicAppType: '',
  functionWorkspace: '',
  functionName: '',
  workflowType: '',
  workflowName: '',
  targetFramework: '',
  logicAppName: '',
  projectType: '',
  openBehavior: '',
  isLoading: false,
  isComplete: false,
};

export const createWorkspaceSlice: any = createSlice({
  name: 'createWorkspace',
  initialState,
  reducers: {
    setCurrentStep: (state, action: PayloadAction<number>) => {
      state.currentStep = action.payload;
    },
    setProjectPathAlt: (state, action: PayloadAction<ITargetDirectory | string>) => {
      if (typeof action.payload === 'string') {
        state.workspaceProjectPath = { path: action.payload, fsPath: action.payload };
      } else if (action.payload && typeof action.payload === 'object' && 'path' in action.payload && 'fsPath' in action.payload) {
        state.workspaceProjectPath = action.payload;
      } else {
        state.workspaceProjectPath = { path: '', fsPath: '' };
      }
    },
    setProjectPath: (state, action: PayloadAction<{ targetDirectory: ITargetDirectory }>) => {
      const { targetDirectory } = action.payload;
      state.workspaceProjectPath = targetDirectory;
    },
    setWorkspaceName: (state, action: PayloadAction<string>) => {
      state.workspaceName = action.payload;
    },
    setLogicAppType: (state, action: PayloadAction<string>) => {
      state.logicAppType = action.payload;
    },
    setFunctionWorkspace: (state, action: PayloadAction<string>) => {
      state.functionWorkspace = action.payload;
    },
    setFunctionName: (state, action: PayloadAction<string>) => {
      state.functionName = action.payload;
    },
    setWorkflowType: (state, action: PayloadAction<string>) => {
      state.workflowType = action.payload;
    },
    setWorkflowName: (state, action: PayloadAction<string>) => {
      state.workflowName = action.payload;
    },
    setTargetFramework: (state, action: PayloadAction<string>) => {
      state.targetFramework = action.payload;
    },
    setLogicAppName: (state, action: PayloadAction<string>) => {
      state.logicAppName = action.payload;
    },
    setProjectType: (state, action: PayloadAction<string>) => {
      state.projectType = action.payload;
    },
    setOpenBehavior: (state, action: PayloadAction<string>) => {
      state.openBehavior = action.payload;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setError: (state, action: PayloadAction<string | undefined>) => {
      state.error = action.payload;
    },
    setComplete: (state, action: PayloadAction<boolean>) => {
      state.isComplete = action.payload;
    },
    resetState: () => initialState,
    nextStep: (state) => {
      if (state.currentStep < 7) {
        // Maximum of 8 steps (0-7) for custom code, 7 steps (0-6) for others
        state.currentStep += 1;
      }
    },
    previousStep: (state) => {
      if (state.currentStep > 0) {
        state.currentStep -= 1;
      }
    },
  },
});

export const {
  setCurrentStep,
  setProjectPath,
  setProjectPathAlt,
  setWorkspaceName,
  setLogicAppType,
  setFunctionWorkspace,
  setFunctionName,
  setWorkflowType,
  setWorkflowName,
  setTargetFramework,
  setLogicAppName,
  setProjectType,
  setOpenBehavior,
  setLoading,
  setError,
  setComplete,
  resetState,
  nextStep,
  previousStep,
} = createWorkspaceSlice.actions;

export default createWorkspaceSlice.reducer;

export type CreateWorkspaceReducer = ReturnType<typeof createWorkspaceSlice.reducer>;
