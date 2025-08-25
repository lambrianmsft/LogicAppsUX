/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Text, RadioGroup, Radio, Field, Input, Label, useId } from '@fluentui/react-components';
import type { InputOnChangeData } from '@fluentui/react-components';
import { useCreateWorkspaceStyles } from '../createWorkspaceStyles';
import type { RootState } from '../../../state/store';
import type { CreateWorkspaceState } from '../../../state/createWorkspace/createWorkspaceSlice';
import { setDotNetFramework, setFunctionWorkspace, setFunctionName } from '../../../state/createWorkspace/createWorkspaceSlice';
import { useIntl } from 'react-intl';
import { useSelector, useDispatch } from 'react-redux';
import { XLargeText } from '@microsoft/designer-ui';

export const DotNetFrameworkStep: React.FC = () => {
  const dispatch = useDispatch();
  const intl = useIntl();
  const styles = useCreateWorkspaceStyles();
  const createWorkspaceState = useSelector((state: RootState) => state.createWorkspace) as CreateWorkspaceState;
  const { dotNetFramework, functionWorkspace, functionName } = createWorkspaceState;

  const functionWorkspaceId = useId();
  const functionNameId = useId();

  const intlText = {
    TITLE: intl.formatMessage({
      defaultMessage: 'Custom Code Configuration',
      id: 'um0VMI',
      description: 'Custom code configuration step title',
    }),
    DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Configure the settings for your custom code logic app',
      id: 'esTnYd',
      description: 'Custom code configuration step description',
    }),
    NET_FRAMEWORK_LABEL: intl.formatMessage({
      defaultMessage: '.NET Framework',
      id: 'xQHAPW',
      description: '.NET Framework option',
    }),
    NET_FRAMEWORK_DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Use the traditional .NET Framework for legacy compatibility',
      id: 'VLHQ4L',
      description: '.NET Framework description',
    }),
    NET_8_LABEL: intl.formatMessage({
      defaultMessage: '.NET 8',
      id: 't2nswK',
      description: '.NET 8 option',
    }),
    NET_8_DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Use the latest .NET 8 for modern development and performance',
      id: 'q1dxkD',
      description: '.NET 8 description',
    }),
    FUNCTION_WORKSPACE_LABEL: intl.formatMessage({
      defaultMessage: 'Function Workspace',
      id: 'mBP+0f',
      description: 'Function workspace input label',
    }),
    FUNCTION_NAME_LABEL: intl.formatMessage({
      defaultMessage: 'Function Name',
      id: 'q8vsUq',
      description: 'Function name input label',
    }),
  };

  const handleDotNetFrameworkChange = (event: React.FormEvent<HTMLDivElement>, data: { value: string }) => {
    dispatch(setDotNetFramework(data.value));
  };

  const handleFunctionWorkspaceChange = (event: React.FormEvent<HTMLInputElement>, data: InputOnChangeData) => {
    dispatch(setFunctionWorkspace(data.value));
  };

  const handleFunctionNameChange = (event: React.FormEvent<HTMLInputElement>, data: InputOnChangeData) => {
    dispatch(setFunctionName(data.value));
  };

  return (
    <div className={styles.formSection}>
      <XLargeText text={intlText.TITLE} className={styles.sectionTitle} style={{ display: 'block' }} />
      <Text className={styles.stepDescription}>{intlText.DESCRIPTION}</Text>

      <div className={styles.radioGroupContainer}>
        <RadioGroup value={dotNetFramework} onChange={handleDotNetFrameworkChange} className={styles.radioGroup}>
          <div className={styles.radioOption}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <Radio value="netFramework" label={intlText.NET_FRAMEWORK_LABEL} />
              <Text size={200} style={{ color: 'var(--colorNeutralForeground2)', margin: '0', padding: '0', lineHeight: '20px' }}>
                {intlText.NET_FRAMEWORK_DESCRIPTION}
              </Text>
            </div>
          </div>
          <div className={styles.radioOption}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <Radio value="net8" label={intlText.NET_8_LABEL} />
              <Text size={200} style={{ color: 'var(--colorNeutralForeground2)', margin: '0', padding: '0', lineHeight: '20px' }}>
                {intlText.NET_8_DESCRIPTION}
              </Text>
            </div>
          </div>
        </RadioGroup>
      </div>

      <div className={styles.fieldContainer} style={{ marginTop: '24px' }}>
        <Field required>
          <Label htmlFor={functionWorkspaceId}>{intlText.FUNCTION_WORKSPACE_LABEL}</Label>
          <Input
            id={functionWorkspaceId}
            value={functionWorkspace}
            onChange={handleFunctionWorkspaceChange}
            className={styles.inputControl}
          />
        </Field>
      </div>

      <div className={styles.fieldContainer}>
        <Field required>
          <Label htmlFor={functionNameId}>{intlText.FUNCTION_NAME_LABEL}</Label>
          <Input id={functionNameId} value={functionName} onChange={handleFunctionNameChange} className={styles.inputControl} />
        </Field>
      </div>
    </div>
  );
};
