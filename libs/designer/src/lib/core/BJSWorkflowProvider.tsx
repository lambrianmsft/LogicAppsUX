import type { Workflow } from '../common/models/workflow';
import { ProviderWrappedContext } from './ProviderWrappedContext';
import { deserializeUnitTestDefinition } from './parsers/BJSWorkflow/BJSDeserializer';
import { initializeGraphState } from './parsers/ParseReduxAction';
import { initCustomCode } from './state/customcode/customcodeSlice';
import { useAreDesignerOptionsInitialized, useAreServicesInitialized } from './state/designerOptions/designerOptionsSelectors';
import { initializeServices } from './state/designerOptions/designerOptionsSlice';
import { initUnitTestDefinition } from './state/unitTest/unitTestSlice';
import { initWorkflowKind, initRunInstance, initWorkflowSpec } from './state/workflow/workflowSlice';
import type { AppDispatch } from './store';
import { parseWorkflowKind } from './utils/workflow';
import type { LogicAppsV2, UnitTestDefinition } from '@microsoft/logic-apps-shared';
import { useDeepCompareEffect } from '@react-hookz/web';
import React, { useContext, useEffect } from 'react';
import { useQuery } from 'react-query';
import { useDispatch } from 'react-redux';

export interface BJSWorkflowProviderProps {
  workflow: Workflow;
  customCode?: Record<string, string>;
  runInstance?: LogicAppsV2.RunInstanceDefinition | null;
  children?: React.ReactNode;
  appSettings?: Record<string, any>;
  unitTestDefinition?: UnitTestDefinition | null;
}

const DataProviderInner: React.FC<BJSWorkflowProviderProps> = ({
  workflow,
  children,
  runInstance,
  customCode,
  appSettings,
  unitTestDefinition,
}) => {
  const dispatch = useDispatch<AppDispatch>();

  useDeepCompareEffect(() => {
    dispatch(initWorkflowSpec('BJS'));
    dispatch(initWorkflowKind(parseWorkflowKind(workflow?.kind)));
    dispatch(initRunInstance(runInstance ?? null));
    dispatch(initCustomCode(customCode));
    dispatch(initializeGraphState({ workflowDefinition: workflow, runInstance }));
    dispatch(initUnitTestDefinition(deserializeUnitTestDefinition(unitTestDefinition ?? null, workflow)));
  }, [runInstance, workflow, customCode, unitTestDefinition]);

  // Store app settings in query to access outside of functional components
  useQuery({ queryKey: ['appSettings'], initialData: appSettings });

  return <>{children}</>;
};

export const BJSWorkflowProvider: React.FC<BJSWorkflowProviderProps> = (props) => {
  const wrapped = useContext(ProviderWrappedContext);
  const dispatch = useDispatch<AppDispatch>();
  const servicesInitialized = useAreServicesInitialized();
  const designerOptionsInitialized = useAreDesignerOptionsInitialized();

  if (!wrapped) {
    throw new Error('BJSWorkflowProvider must be used inside of a DesignerProvider');
  }

  useEffect(() => {
    if (!servicesInitialized) {
      dispatch(initializeServices(wrapped));
    }
  }, [dispatch, servicesInitialized, wrapped]);

  if (!designerOptionsInitialized || !servicesInitialized) {
    return null;
  }

  return <DataProviderInner {...props} />;
};
