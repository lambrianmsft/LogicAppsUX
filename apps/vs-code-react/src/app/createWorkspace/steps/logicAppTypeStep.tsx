/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Text, RadioGroup, Radio, Field, Input } from '@fluentui/react-components';
import { useCreateWorkspaceStyles } from '../createWorkspaceStyles';
import type { RootState } from '../../../state/store';
import type { CreateWorkspaceState } from '../../../state/createWorkspace/createWorkspaceSlice';
import { setLogicAppType, setLogicAppName, setTargetFramework } from '../../../state/createWorkspace/createWorkspaceSlice';
import { useIntl } from 'react-intl';
import { useSelector, useDispatch } from 'react-redux';

export const LogicAppTypeStep: React.FC = () => {
  const dispatch = useDispatch();
  const intl = useIntl();
  const styles = useCreateWorkspaceStyles();
  const createWorkspaceState = useSelector((state: RootState) => state.createWorkspace) as CreateWorkspaceState;
  const { logicAppType, logicAppName, workspaceName, workspaceProjectPath } = createWorkspaceState;
  const separator = workspaceProjectPath.fsPath?.includes('/') ? '/' : '\\';

  const intlText = {
    TITLE: intl.formatMessage({
      defaultMessage: 'Logic App Details',
      id: 'XJ1S7E',
      description: 'Logic app details step title',
    }),
    DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Enter the logic app name and select the type of logic app to create',
      id: 'VPcN7p',
      description: 'Logic app details step description',
    }),
    LOGIC_APP_NAME_LABEL: intl.formatMessage({
      defaultMessage: 'Logic App Name',
      id: 'JS7xBY',
      description: 'Logic app name field label',
    }),
    LOGIC_APP_NAME_PLACEHOLDER: intl.formatMessage({
      defaultMessage: 'Enter logic app name',
      id: 'ceM0tn',
      description: 'Logic app name field placeholder',
    }),
    STANDARD_LABEL: intl.formatMessage({
      defaultMessage: 'Logic App (Standard)',
      id: 'xnJNZH',
      description: 'Standard logic app option',
    }),
    STANDARD_DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Standard logic app with built-in connectors and triggers',
      id: 'CfXSvL',
      description: 'Standard logic app description',
    }),
    CUSTOM_CODE_LABEL: intl.formatMessage({
      defaultMessage: 'Logic App with Custom Code',
      id: '2ivADw',
      description: 'Logic app with custom code option',
    }),
    CUSTOM_CODE_DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Logic app that allows custom code integration and advanced scenarios',
      id: 'kkKTEH',
      description: 'Logic app with custom code description',
    }),
    RULES_ENGINE_LABEL: intl.formatMessage({
      defaultMessage: 'Logic App with Rules Engine',
      id: 'yoH8Yw',
      description: 'Logic app with rules engine option',
    }),
    RULES_ENGINE_DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Logic app with built-in business rules engine for complex decision logic',
      id: 'Fsc9ZE',
      description: 'Logic app with rules engine description',
    }),
  };

  const handleLogicAppTypeChange = (event: React.FormEvent<HTMLDivElement>, data: { value: string }) => {
    dispatch(setLogicAppType(data.value));
    if (data.value === 'rulesEngine') {
      dispatch(setTargetFramework('net472'));
    }
  };

  const handleLogicAppNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setLogicAppName(event.target.value));
  };

  return (
    <div className={styles.formSection}>
      <Text className={styles.sectionTitle} style={{ display: 'block' }}>
        {intlText.TITLE}
      </Text>
      <Text className={styles.stepDescription}>{intlText.DESCRIPTION}</Text>

      <div className={styles.inputField}>
        <Field label={intlText.LOGIC_APP_NAME_LABEL} required>
          <Input
            value={logicAppName}
            onChange={handleLogicAppNameChange}
            placeholder={intlText.LOGIC_APP_NAME_PLACEHOLDER}
            className={styles.inputControl}
          />
          {logicAppName && workspaceName && workspaceProjectPath.path && (
            <Text
              size={200}
              style={{
                color: 'var(--colorNeutralForeground2)',
                fontFamily: 'monospace',
                marginTop: '4px',
                display: 'block',
                wordBreak: 'break-all',
              }}
            >
              {`${workspaceProjectPath.fsPath}${separator}${workspaceName}${separator}${logicAppName}`}
            </Text>
          )}
        </Field>
      </div>

      <div>
        <RadioGroup value={logicAppType} onChange={handleLogicAppTypeChange} className={styles.radioGroup}>
          <div className={styles.radioOption}>
            <Radio value="logicApp" label={intlText.STANDARD_LABEL} />
            <Text size={200} style={{ marginLeft: '24px', color: 'var(--colorNeutralForeground2)' }}>
              {intlText.STANDARD_DESCRIPTION}
            </Text>
          </div>
          <div className={styles.radioOption}>
            <Radio value="customCode" label={intlText.CUSTOM_CODE_LABEL} />
            <Text size={200} style={{ marginLeft: '24px', color: 'var(--colorNeutralForeground2)' }}>
              {intlText.CUSTOM_CODE_DESCRIPTION}
            </Text>
          </div>
          <div className={styles.radioOption}>
            <Radio value="rulesEngine" label={intlText.RULES_ENGINE_LABEL} />
            <Text size={200} style={{ marginLeft: '24px', color: 'var(--colorNeutralForeground2)' }}>
              {intlText.RULES_ENGINE_DESCRIPTION}
            </Text>
          </div>
        </RadioGroup>
      </div>
    </div>
  );
};
