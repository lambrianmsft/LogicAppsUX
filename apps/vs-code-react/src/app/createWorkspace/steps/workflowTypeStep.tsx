/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Radio, Field, Input } from '@fluentui/react-components';
import { useCreateWorkspaceStyles } from '../createWorkspaceStyles';
import type { RootState } from '../../../state/store';
import type { CreateWorkspaceState } from '../../../state/createWorkspace/createWorkspaceSlice';
import { setWorkflowType, setLogicAppName } from '../../../state/createWorkspace/createWorkspaceSlice';
import { useIntl } from 'react-intl';
import { useSelector, useDispatch } from 'react-redux';
import { XLargeText } from '@microsoft/designer-ui';

export const WorkflowTypeStep: React.FC = () => {
  const dispatch = useDispatch();
  const intl = useIntl();
  const styles = useCreateWorkspaceStyles();
  const createWorkspaceState = useSelector((state: RootState) => state.createWorkspace) as CreateWorkspaceState;
  const { workflowType, logicAppName } = createWorkspaceState;

  const intlText = {
    TITLE: intl.formatMessage({
      defaultMessage: 'Workflow Configuration',
      id: '81liT7',
      description: 'Workflow configuration step title',
    }),
    WORKFLOW_NAME_LABEL: intl.formatMessage({
      defaultMessage: 'Workflow name',
      id: 'zTdffa',
      description: 'Workflow name field label',
    }),
    WORKFLOW_NAME_PLACEHOLDER: intl.formatMessage({
      defaultMessage: 'Enter workflow name',
      id: 'nVhDGu',
      description: 'Workflow name field placeholder',
    }),
    STATEFUL_TITLE: intl.formatMessage({
      defaultMessage: 'Stateful',
      id: 'p4Mgce',
      description: 'Stateful workflow option',
    }),
    STATEFUL_DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Optimized for high reliability, ideal for process business transitional data.',
      id: 'otRX33',
      description: 'Stateful workflow description',
    }),
    STATELESS_TITLE: intl.formatMessage({
      defaultMessage: 'Stateless',
      id: 'R7gB/3',
      description: 'Stateless workflow option',
    }),
    STATELESS_DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Optimized for low latency, ideal for request-response and processing IoT events.',
      id: 'b0wO2+',
      description: 'Stateless workflow description',
    }),
    AUTONOMOUS_TITLE: intl.formatMessage({
      defaultMessage: 'Autonomous Agents (Preview)',
      id: 'qs798U',
      description: 'Autonomous agents workflow option',
    }),
    AUTONOMOUS_DESCRIPTION: intl.formatMessage({
      defaultMessage: 'All the benefits of Stateful, plus the option to build AI agents in your workflow to automate complex tasks.',
      id: 'Bft/H3',
      description: 'Autonomous agents workflow description',
    }),
  };

  const handleWorkflowTypeChange = (event: React.FormEvent<HTMLDivElement>, data: { value: string }) => {
    dispatch(setWorkflowType(data.value));
  };

  const handleWorkflowNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setLogicAppName(event.target.value));
  };

  return (
    <div className={styles.formSection}>
      <XLargeText text={intlText.TITLE} className={styles.sectionTitle} style={{ display: 'block' }} />

      <Field label={intlText.WORKFLOW_NAME_LABEL} className={styles.workflowNameField}>
        <Input
          value={logicAppName}
          onChange={handleWorkflowNameChange}
          placeholder={intlText.WORKFLOW_NAME_PLACEHOLDER}
          className={styles.inputControl}
        />
      </Field>

      <table className={styles.workflowTable}>
        <thead>
          <tr>
            <th className={styles.workflowTableHeader} style={{ width: '140px' }}>
              Features
            </th>
            <th
              className={styles.workflowTableHeader}
              style={{ textAlign: 'center', cursor: 'pointer' }}
              onClick={() => dispatch(setWorkflowType('AutonomousAgents'))}
            >
              <div className={styles.workflowColumnHeader}>
                <div className={styles.workflowRadioContainer}>
                  <Radio value="AutonomousAgents" checked={workflowType === 'AutonomousAgents'} onChange={handleWorkflowTypeChange} />
                </div>
                <div className={styles.workflowTypeContent}>
                  <div className={styles.workflowTypeTitle}>{intlText.AUTONOMOUS_TITLE}</div>
                  <div className={styles.workflowTypeDescription} style={{ fontSize: '12px', marginTop: '4px' }}>
                    {intlText.AUTONOMOUS_DESCRIPTION}
                  </div>
                </div>
              </div>
            </th>
            <th
              className={styles.workflowTableHeader}
              style={{ textAlign: 'center', cursor: 'pointer' }}
              onClick={() => dispatch(setWorkflowType('Stateful'))}
            >
              <div className={styles.workflowColumnHeader}>
                <div className={styles.workflowRadioContainer}>
                  <Radio value="Stateful" checked={workflowType === 'Stateful'} onChange={handleWorkflowTypeChange} />
                </div>
                <div className={styles.workflowTypeContent}>
                  <div className={styles.workflowTypeTitle}>{intlText.STATEFUL_TITLE}</div>
                  <div className={styles.workflowTypeDescription} style={{ fontSize: '12px', marginTop: '4px' }}>
                    {intlText.STATEFUL_DESCRIPTION}
                  </div>
                </div>
              </div>
            </th>
            <th
              className={styles.workflowTableHeader}
              style={{ textAlign: 'center', cursor: 'pointer' }}
              onClick={() => dispatch(setWorkflowType('Stateless'))}
            >
              <div className={styles.workflowColumnHeader}>
                <div className={styles.workflowRadioContainer}>
                  <Radio value="Stateless" checked={workflowType === 'Stateless'} onChange={handleWorkflowTypeChange} />
                </div>
                <div className={styles.workflowTypeContent}>
                  <div className={styles.workflowTypeTitle}>{intlText.STATELESS_TITLE}</div>
                  <div className={styles.workflowTypeDescription} style={{ fontSize: '12px', marginTop: '4px' }}>
                    {intlText.STATELESS_DESCRIPTION}
                  </div>
                </div>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className={styles.workflowTableRow}>
            <td className={styles.workflowTableCell} style={{ fontWeight: 'bold' }}>
              Build agents
            </td>
            <td className={styles.checkmarkCell}>✓</td>
            <td className={styles.emptyCell}>--</td>
            <td className={styles.emptyCell}>--</td>
          </tr>

          <tr className={styles.workflowTableRow}>
            <td className={styles.workflowTableCell} style={{ fontWeight: 'bold' }}>
              Move most quickly
            </td>
            <td className={styles.emptyCell}>--</td>
            <td className={styles.emptyCell}>--</td>
            <td className={styles.checkmarkCell}>✓</td>
          </tr>

          <tr className={styles.workflowTableRow}>
            <td className={styles.workflowTableCell} style={{ fontWeight: 'bold' }}>
              Store your run history
            </td>
            <td className={styles.checkmarkCell}>✓</td>
            <td className={styles.checkmarkCell}>✓</td>
            <td className={styles.emptyCell}>--</td>
          </tr>

          <tr className={styles.workflowTableRow}>
            <td className={styles.workflowTableCell} style={{ fontWeight: 'bold' }}>
              Run asynchronously
            </td>
            <td className={styles.checkmarkCell}>✓</td>
            <td className={styles.checkmarkCell}>✓</td>
            <td className={styles.emptyCell}>--</td>
          </tr>

          <tr className={styles.workflowTableRow}>
            <td className={styles.workflowTableCell} style={{ fontWeight: 'bold' }}>
              Run longer workflows
            </td>
            <td className={styles.checkmarkCell}>✓</td>
            <td className={styles.checkmarkCell}>✓</td>
            <td className={styles.emptyCell}>--</td>
          </tr>

          <tr className={styles.workflowTableRow}>
            <td className={styles.workflowTableCell} style={{ fontWeight: 'bold' }}>
              Best for handling larger data
            </td>
            <td className={styles.checkmarkCell}>✓</td>
            <td className={styles.checkmarkCell}>✓</td>
            <td className={styles.emptyCell}>--</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};
