import constants from '../../common/constants';
import { getMonitoringError } from '../../common/utilities/error';
import type { AppDispatch, RootState } from '../../core';
import { copyOperation } from '../../core/actions/bjsworkflow/copypaste';
import { moveOperation } from '../../core/actions/bjsworkflow/move';
import {
  useMonitoringView,
  useNodeSelectAdditionalCallback,
  useReadOnly,
  useSuppressDefaultNodeSelectFunctionality,
} from '../../core/state/designerOptions/designerOptionsSelectors';
import { setShowDeleteModalNodeId } from '../../core/state/designerView/designerViewSlice';
import { ErrorLevel } from '../../core/state/operation/operationMetadataSlice';
import {
  useOperationErrorInfo,
  useSecureInputsOutputs,
  useParameterStaticResult,
  useParameterValidationErrors,
  useTokenDependencies,
  useOperationVisuals,
} from '../../core/state/operation/operationSelector';
import { useIsNodeSelected } from '../../core/state/panel/panelSelectors';
import { changePanelNode, selectPanelTab, setSelectedNodeId } from '../../core/state/panel/panelSlice';
import { useIsNodePinnedToOperationPanel, useOperationPanelPinnedNodeId } from '../../core/state/panelV2/panelSelectors';
import { setPinnedNode } from '../../core/state/panelV2/panelSlice';
import {
  useAllOperations,
  useConnectorName,
  useIsConnectionRequired,
  useNodeConnectionName,
  useOperationInfo,
  useOperationQuery,
} from '../../core/state/selectors/actionMetadataSelector';
import { useSettingValidationErrors } from '../../core/state/setting/settingSelector';
import {
  useNodeDescription,
  useNodeDisplayName,
  useNodeMetadata,
  useNodesMetadata,
  useRunData,
  useParentRunIndex,
  useRunInstance,
  useShouldNodeFocus,
  useParentRunId,
  useIsLeafNode,
} from '../../core/state/workflow/workflowSelectors';
import { setRepetitionRunData } from '../../core/state/workflow/workflowSlice';
import { getRepetitionName } from '../common/LoopsPager/helper';
import { DropZone } from '../connections/dropzone';
import { CopyMenuItem } from '../menuItems/copyMenuItem';
import { DeleteMenuItem } from '../menuItems/deleteMenuItem';
import { ResubmitMenuItem } from '../menuItems/resubmitMenuItem';
import { MessageBarType } from '@fluentui/react';
import { Tooltip } from '@fluentui/react-components';
import { RunService, WorkflowService, getRecordEntry, useNodeIndex } from '@microsoft/logic-apps-shared';
import { Card } from '@microsoft/designer-ui';
import type { LogicAppsV2 } from '@microsoft/logic-apps-shared';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useDrag } from 'react-dnd';
import { useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';
import { useDispatch, useSelector } from 'react-redux';
import { Handle, Position, useOnViewportChange, type NodeProps } from '@xyflow/react';
import { useHotkeys } from 'react-hotkeys-hook';
import { RunAfterMenuItem } from '../menuItems/runAfterMenuItem';
import { RUN_AFTER_PANEL_TAB } from './constants';
import { shouldDisplayRunAfter } from './helpers';
import { PinMenuItem } from '../menuItems/pinMenuItem';

const DefaultNode = ({ targetPosition = Position.Top, sourcePosition = Position.Bottom, id }: NodeProps) => {
  const readOnly = useReadOnly();
  const isMonitoringView = useMonitoringView();
  const intl = useIntl();

  const dispatch = useDispatch<AppDispatch>();
  const rootState = useSelector((state: RootState) => state);
  const pinnedNodeId = useOperationPanelPinnedNodeId();
  const operationsInfo = useAllOperations();
  const errorInfo = useOperationErrorInfo(id);
  const metadata = useNodeMetadata(id);
  const operationInfo = useOperationInfo(id);
  const connectorName = useConnectorName(operationInfo);
  const isTrigger = useMemo(() => metadata?.graphId === 'root' && metadata?.isRoot, [metadata]);
  const parentRunIndex = useParentRunIndex(id);
  const runInstance = useRunInstance();
  const runData = useRunData(id);
  const parentRunId = useParentRunId(id);
  const parenRunData = useRunData(parentRunId ?? '');
  const nodesMetaData = useNodesMetadata();
  const repetitionName = getRepetitionName(parentRunIndex, id, nodesMetaData, operationsInfo);
  const isSecureInputsOutputs = useSecureInputsOutputs(id);
  const { status: statusRun, error: errorRun, code: codeRun, repetitionCount } = runData ?? {};

  const suppressDefaultNodeSelect = useSuppressDefaultNodeSelectFunctionality();
  const nodeSelectCallbackOverride = useNodeSelectAdditionalCallback();

  const getRunRepetition = () => {
    if (parenRunData?.status === constants.FLOW_STATUS.SKIPPED) {
      return {
        properties: {
          status: constants.FLOW_STATUS.SKIPPED,
          inputsLink: null,
          outputsLink: null,
          startTime: null,
          endTime: null,
          trackingId: null,
          correlation: null,
        },
      };
    }
    return RunService().getRepetition({ nodeId: id, runId: runInstance?.id }, repetitionName);
  };

  const onRunRepetitionSuccess = async (runDefinition: LogicAppsV2.RunInstanceDefinition) => {
    dispatch(setRepetitionRunData({ nodeId: id, runData: runDefinition.properties as any }));
  };

  const { refetch, isFetching: isRepetitionLoading } = useQuery<any>(
    ['runInstance', { nodeId: id, runId: runInstance?.id, repetitionName, parentStatus: parenRunData?.status }],
    getRunRepetition,
    {
      refetchOnWindowFocus: false,
      initialData: null,
      refetchIntervalInBackground: true,
      onSuccess: onRunRepetitionSuccess,
      enabled: parentRunIndex !== undefined && isMonitoringView && repetitionCount !== undefined,
    }
  );

  useEffect(() => {
    if (parentRunIndex !== undefined && isMonitoringView) {
      refetch();
    }
  }, [dispatch, parentRunIndex, isMonitoringView, refetch, repetitionName, parenRunData?.status]);

  const dependencies = useTokenDependencies(id);

  const [{ isDragging }, drag, dragPreview] = useDrag(
    () => ({
      type: 'BOX',
      end: (item, monitor) => {
        const dropResult = monitor.getDropResult<{
          graphId: string;
          parentId: string;
          childId: string;
        }>();
        if (item && dropResult) {
          dispatch(
            moveOperation({
              nodeId: id,
              oldGraphId: metadata?.graphId ?? 'root',
              newGraphId: dropResult.graphId,
              relationshipIds: dropResult,
            })
          );
        }
      },
      item: {
        id: id,
        dependencies,
        graphId: metadata?.graphId,
      },
      canDrag: !readOnly && !isTrigger,
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    }),
    [readOnly, metadata, dependencies]
  );

  const selected = useIsNodeSelected(id);
  const isPinned = useIsNodePinnedToOperationPanel(id);
  const nodeComment = useNodeDescription(id);
  const connectionResult = useNodeConnectionName(id);
  const isConnectionRequired = useIsConnectionRequired(operationInfo);
  const isLeaf = useIsLeafNode(id);
  const label = useNodeDisplayName(id);

  const showLeafComponents = useMemo(() => !readOnly && isLeaf, [readOnly, isLeaf]);

  const { brandColor, iconUri } = useOperationVisuals(id);

  const comment = useMemo(
    () =>
      nodeComment
        ? {
            brandColor,
            comment: nodeComment,
            isDismissed: false,
            isEditing: false,
          }
        : undefined,
    [brandColor, nodeComment]
  );

  const [showCopyCallout, setShowCopyCallout] = useState(false);

  useOnViewportChange({
    onStart: useCallback(() => {
      if (showCopyCallout) {
        setShowCopyCallout(false);
      }
    }, [showCopyCallout]),
  });

  const handleNodeSelection = useCallback(() => {
    if (nodeSelectCallbackOverride) {
      nodeSelectCallbackOverride(id);
    }
    if (suppressDefaultNodeSelect) {
      dispatch(setSelectedNodeId(id));
    } else {
      dispatch(changePanelNode(id));
    }
  }, [dispatch, id, nodeSelectCallbackOverride, suppressDefaultNodeSelect]);

  const nodeClick = useCallback(() => {
    handleNodeSelection();
  }, [handleNodeSelection]);

  const runAfterClick = useCallback(() => {
    handleNodeSelection();
    dispatch(selectPanelTab(RUN_AFTER_PANEL_TAB));
  }, [dispatch, handleNodeSelection]);

  const deleteClick = useCallback(() => {
    dispatch(setShowDeleteModalNodeId(id));
  }, [dispatch, id]);

  const pinClick = useCallback(() => {
    dispatch(
      setPinnedNode({
        nodeId: id === pinnedNodeId ? '' : id,
        updatePanelOpenState: true,
      })
    );
  }, [dispatch, id, pinnedNodeId]);

  const copyClick = useCallback(() => {
    setShowCopyCallout(true);
    dispatch(copyOperation({ nodeId: id }));
    setTimeout(() => {
      setShowCopyCallout(false);
    }, 3000);
  }, [dispatch, id]);

  const resubmitClick = useCallback(() => {
    WorkflowService().resubmitWorkflow?.(runInstance?.name ?? '', [id]);
  }, [runInstance, id]);

  const operationFromWorkflow = getRecordEntry(rootState.workflow.operations, id) as LogicAppsV2.OperationDefinition;
  const runAfter = shouldDisplayRunAfter(operationFromWorkflow, isTrigger);

  const ref = useHotkeys(['meta+c', 'ctrl+c'], copyClick, { preventDefault: true });
  const contextMenuItems: JSX.Element[] = useMemo(
    () => [
      <DeleteMenuItem key={'delete'} onClick={deleteClick} showKey />,
      <CopyMenuItem key={'copy'} isTrigger={isTrigger} onClick={copyClick} showKey />,
      <PinMenuItem key={'pin'} nodeId={id} onClick={pinClick} />,
      ...(runData?.canResubmit ? [<ResubmitMenuItem key={'resubmit'} onClick={resubmitClick} />] : []),
      ...(runAfter ? [<RunAfterMenuItem key={'run after'} onClick={runAfterClick} />] : []),
    ],
    [copyClick, deleteClick, id, isTrigger, pinClick, resubmitClick, runData?.canResubmit, runAfterClick, runAfter]
  );

  const { isFetching: isOperationQueryLoading, isError: isOperationQueryError } = useOperationQuery(id);

  const isLoading = useMemo(() => isRepetitionLoading || isOperationQueryLoading, [isRepetitionLoading, isOperationQueryLoading]);

  const opManifestErrorText = intl.formatMessage({
    defaultMessage: 'Error fetching manifest',
    id: 'HmcHoE',
    description: 'Error message when manifest fails to load',
  });

  const settingValidationErrors = useSettingValidationErrors(id);
  const settingValidationErrorText = intl.formatMessage({
    defaultMessage: 'Invalid settings',
    id: 'Jil/Wa',
    description: 'Text to explain that there are invalid settings for this node',
  });

  const parameterValidationErrors = useParameterValidationErrors(id);
  const parameterValidationErrorText = intl.formatMessage({
    defaultMessage: 'Invalid parameters',
    id: 'Tmr/9e',
    description: 'Text to explain that there are invalid parameters for this node',
  });

  const { errorMessage, errorLevel } = useMemo(() => {
    if (errorInfo && errorInfo.level !== ErrorLevel.DynamicOutputs) {
      const { message, level } = errorInfo;
      return {
        errorMessage: message,
        errorLevel:
          level !== ErrorLevel.Default && level !== ErrorLevel.DynamicInputs ? MessageBarType.error : MessageBarType.severeWarning,
      };
    }

    if (isOperationQueryError) {
      return { errorMessage: opManifestErrorText, errorLevel: MessageBarType.error };
    }

    if (settingValidationErrors?.length > 0) {
      return { errorMessage: settingValidationErrorText, errorLevel: MessageBarType.severeWarning };
    }

    if (parameterValidationErrors?.length > 0) {
      return { errorMessage: parameterValidationErrorText, errorLevel: MessageBarType.severeWarning };
    }

    if (isMonitoringView) {
      return getMonitoringError(errorRun, statusRun, codeRun);
    }

    return { errorMessage: undefined, errorLevel: undefined };
  }, [
    errorInfo,
    isOperationQueryError,
    settingValidationErrors?.length,
    parameterValidationErrors?.length,
    isMonitoringView,
    opManifestErrorText,
    settingValidationErrorText,
    parameterValidationErrorText,
    errorRun,
    statusRun,
    codeRun,
  ]);

  const shouldFocus = useShouldNodeFocus(id);
  const staticResults = useParameterStaticResult(id);

  const copiedText = intl.formatMessage({
    defaultMessage: 'Copied!',
    id: 'NE54Uu',
    description: 'Copied text',
  });

  const nodeIndex = useNodeIndex(id);

  return (
    <>
      <div className="nopan" ref={ref as any}>
        <Handle className="node-handle top" type="target" position={targetPosition} isConnectable={false} />
        <Card
          title={label}
          icon={iconUri}
          draggable={!readOnly && !isTrigger}
          brandColor={brandColor}
          id={id}
          connectionRequired={isConnectionRequired}
          connectionDisplayName={connectionResult.isLoading ? '...' : connectionResult.result}
          connectorName={connectorName?.result}
          commentBox={comment}
          drag={drag}
          dragPreview={dragPreview}
          errorMessage={errorMessage}
          errorLevel={errorLevel}
          isDragging={isDragging}
          isLoading={isLoading}
          isMonitoringView={isMonitoringView}
          runData={runData}
          readOnly={readOnly}
          onClick={nodeClick}
          onDeleteClick={deleteClick}
          onCopyClick={copyClick}
          selectionMode={selected ? 'selected' : isPinned ? 'pinned' : false}
          contextMenuItems={contextMenuItems}
          setFocus={shouldFocus}
          staticResultsEnabled={!!staticResults}
          isSecureInputsOutputs={isSecureInputsOutputs}
          nodeIndex={nodeIndex}
        />
        <Tooltip
          positioning={{ target: ref.current, position: 'below', align: 'end' }}
          withArrow
          content={copiedText}
          relationship="description"
          visible={showCopyCallout}
        />
        <Handle className="node-handle bottom" type="source" position={sourcePosition} isConnectable={false} />
      </div>
      {showLeafComponents ? (
        <div className={'edge-drop-zone-container'}>
          <DropZone graphId={metadata?.graphId ?? ''} parentId={id} isLeaf={isLeaf} tabIndex={nodeIndex} />
        </div>
      ) : null}
    </>
  );
};

DefaultNode.displayName = 'DefaultNode';

export default memo(DefaultNode);
