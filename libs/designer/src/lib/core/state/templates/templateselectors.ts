import { useSelector } from 'react-redux';
import type { RootState } from './store';
import type { WorkflowTemplateData } from '../../actions/bjsworkflow/templates';
import type { ConnectionReference } from '../../../common/models/workflow';
import type { Template } from '@microsoft/logic-apps-shared';
import { getFilteredTemplates } from '../../templates/utils/helper';

export const useTemplateWorkflows = () => {
  return useSelector((state: RootState) => state.template.workflows ?? {});
};

export const useWorkflowTemplate = (workflowId: string): WorkflowTemplateData | undefined => {
  return useSelector((state: RootState) => {
    return state.template.workflows?.[workflowId];
  });
};

export const useTemplateManifest = (): Template.TemplateManifest | undefined => {
  return useSelector((state: RootState) => {
    return state.template.manifest;
  });
};

export const useWorkflowBasicsEditable = (workflowId: string) => {
  return useSelector((state: RootState) => {
    return {
      isNameEditable: state.templateOptions.viewTemplateDetails?.basicsOverride?.[workflowId]?.name?.isEditable ?? true,
      isKindEditable: state.templateOptions.viewTemplateDetails?.basicsOverride?.[workflowId]?.kind?.isEditable ?? true,
    };
  });
};

export const useConnectionReferenceForKey = (key: string): ConnectionReference => {
  return useSelector((state: RootState) => {
    const connections = state.workflow.connections;
    return connections.references[connections.mapping[key] ?? ''];
  });
};

export const useTemplateConnections = (): Record<string, Template.Connection> => {
  return useSelector((state: RootState) => state.template?.connections);
};

export const useTemplateParameterDefinitions = (): Record<string, Template.ParameterDefinition> => {
  return useSelector((state: RootState) => state.template?.parameterDefinitions);
};

export const useFilteredTemplateNames = () => {
  return useSelector((state: RootState) => {
    const isConsumption = state.workflow.isConsumption;
    const availableTemplates = state.manifest.availableTemplates;
    const filters = state.manifest.filters;
    if (!availableTemplates) {
      return undefined;
    }
    return getFilteredTemplates(availableTemplates, filters, !!isConsumption);
  });
};
