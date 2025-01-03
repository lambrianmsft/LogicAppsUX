import type { Rect } from '@xyflow/react';
import type { FunctionDictionary } from '../models';
import type { ConnectionDictionary } from '../models/Connection';
import type { ConnectionAndOrder, FunctionMetadata, MapMetadataV2 } from '@microsoft/logic-apps-shared';
import { isNodeConnection } from '../utils/Connection.Utils';

export const generateMapMetadata = (
  functionDictionary: FunctionDictionary,
  connections: ConnectionDictionary,
  canvasRect: Rect
): MapMetadataV2 => {
  const functionMetadata: FunctionMetadata[] = [];

  Object.entries(functionDictionary).forEach(([functionKey, functionValue]) => {
    const connectionIdMetadata = generateFunctionConnectionMetadata(functionKey, connections);
    functionMetadata.push({
      reactFlowGuid: functionKey,
      functionKey: functionValue.key,
      position: functionValue.position || { x: 0, y: 0 },
      connections: connectionIdMetadata,
      connectionShorthand: convertConnectionShorthandToId(connectionIdMetadata),
    });
  });

  return {
    functionNodes: functionMetadata,
    canvasRect,
  };
};

export const convertConnectionShorthandToId = (connectionArr: ConnectionAndOrder[]): string => {
  let ans = '';
  connectionArr.forEach((obj) => {
    ans = `${ans}${obj.inputOrder}-${obj.name},`;
  });
  return ans;
};

export const generateFunctionConnectionMetadata = (connectionKey: string, connections: ConnectionDictionary): ConnectionAndOrder[] => {
  const connection = connections[connectionKey];

  if (connection) {
    const results: ConnectionAndOrder[] = [];
    if (connection.outputs[0] === undefined) {
      return results;
    }
    const firstOutputKey = connection.outputs[0].reactFlowKey;
    let index = 0;
    const firstOutputObj = connections[firstOutputKey];
    const outputsInput = firstOutputObj.inputs;
    while (outputsInput[index]) {
      const possibleMatchingInput = outputsInput[index];
      if (possibleMatchingInput && isNodeConnection(possibleMatchingInput) && possibleMatchingInput.reactFlowKey === connectionKey) {
        const connAndOrder: ConnectionAndOrder = {
          name: firstOutputKey,
          inputOrder: index,
        };
        if ('functionName' in firstOutputObj.self.node) {
          connAndOrder.name = firstOutputObj.self.node.functionName;
        }
        results.push(connAndOrder);
        results.push(...generateFunctionConnectionMetadata(firstOutputKey, connections));
        break;
      }
      index++;
    }

    return results;
  }

  return [];
};
