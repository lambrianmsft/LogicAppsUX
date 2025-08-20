/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { RadioGroup, Radio } from '@fluentui/react-components';
import { useCreateWorkspaceStyles } from '../createWorkspaceStyles';
import type { RootState } from '../../../state/store';
import type { CreateWorkspaceState } from '../../../state/createWorkspace/createWorkspaceSlice';
import { setTargetFramework } from '../../../state/createWorkspace/createWorkspaceSlice';
import { useIntl } from 'react-intl';
import { useSelector, useDispatch } from 'react-redux';
import { XLargeText } from '@microsoft/designer-ui';

export const TargetFrameworkStep: React.FC = () => {
  const dispatch = useDispatch();
  const intl = useIntl();
  const styles = useCreateWorkspaceStyles();
  const createWorkspaceState = useSelector((state: RootState) => state.createWorkspace) as CreateWorkspaceState;
  const { targetFramework } = createWorkspaceState;

  const intlText = {
    TITLE: intl.formatMessage({
      defaultMessage: 'Target Framework',
      id: 'dCxnEO',
      description: 'Target framework step title',
    }),
    DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Select the .NET framework version for your logic app',
      id: 'PhtDCq',
      description: 'Target framework step description',
    }),
    NET6_LABEL: intl.formatMessage({
      defaultMessage: '.NET 6',
      id: 'KVqrQe',
      description: '.NET 6 framework option',
    }),
    NET8_LABEL: intl.formatMessage({
      defaultMessage: '.NET 8',
      id: 'B0KbUc',
      description: '.NET 8 framework option',
    }),
  };

  const handleTargetFrameworkChange = (event: React.FormEvent<HTMLDivElement>, data: { value: string }) => {
    dispatch(setTargetFramework(data.value));
  };

  return (
    <div className={styles.formSection}>
      <XLargeText text={intlText.TITLE} className={styles.sectionTitle} style={{ display: 'block' }} />
      <div className={styles.radioGroupContainer}>
        <RadioGroup value={targetFramework} onChange={handleTargetFrameworkChange} className={styles.radioGroup}>
          <Radio value="net6.0" label={intlText.NET6_LABEL} className={styles.radioOption} />
          <Radio value="net8.0" label={intlText.NET8_LABEL} className={styles.radioOption} />
        </RadioGroup>
      </div>
    </div>
  );
};
