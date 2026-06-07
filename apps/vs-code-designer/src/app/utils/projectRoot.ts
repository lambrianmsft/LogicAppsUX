/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { isLogicAppProject } from './verifyIsProject';

/**
 * Resolve the directory where a new Logic App project should be created.
 *
 * VS Code workspace files can live either in the workspace container folder or
 * inside a single Logic App project. Creating another project under the latter
 * would nest Logic App projects, so walk up from the workspace file folder and
 * place the new project next to the containing Logic App project instead.
 */
export async function resolveProjectCreationWorkspaceRoot(workspaceFilePath: string): Promise<string> {
  const workspaceFileFolder = path.dirname(workspaceFilePath);
  let currentFolder = workspaceFileFolder;

  while (true) {
    const parentFolder = path.dirname(currentFolder);
    if (parentFolder === currentFolder) {
      return workspaceFileFolder;
    }

    if (await isLogicAppProject(currentFolder)) {
      return parentFolder;
    }

    currentFolder = parentFolder;
  }
}
