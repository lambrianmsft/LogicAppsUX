/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Text, RadioGroup, Radio } from '@fluentui/react-components';
import { useCreateWorkspaceStyles } from '../createWorkspaceStyles';
import type { RootState } from '../../../state/store';
import type { CreateWorkspaceState } from '../../../state/createWorkspace/createWorkspaceSlice';
import { setLogicAppType } from '../../../state/createWorkspace/createWorkspaceSlice';
import { useIntl } from 'react-intl';
import { useSelector, useDispatch } from 'react-redux';
import { XLargeText } from '@microsoft/designer-ui';

export const LogicAppTypeStep: React.FC = () => {
  const dispatch = useDispatch();
  const intl = useIntl();
  const styles = useCreateWorkspaceStyles();
  const createWorkspaceState = useSelector((state: RootState) => state.createWorkspace) as CreateWorkspaceState;
  const { logicAppType } = createWorkspaceState;

  const intlText = {
    TITLE: intl.formatMessage({
      defaultMessage: 'Logic App Type',
      id: '0Y1k/0',
      description: 'Logic app type step title',
    }),
    DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Select the type of logic app to create',
      id: '7yXXiY',
      description: 'Logic app type step description',
    }),
    STATEFUL_LABEL: intl.formatMessage({
      defaultMessage: 'Stateful',
      id: 'P3L+ba',
      description: 'Stateful logic app option',
    }),
    STATEFUL_DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Stateful workflows maintain state information between runs',
      id: 'OrLQ/7',
      description: 'Stateful logic app description',
    }),
    STATELESS_LABEL: intl.formatMessage({
      defaultMessage: 'Stateless',
      id: 'zi+FBg',
      description: 'Stateless logic app option',
    }),
    STATELESS_DESCRIPTION: intl.formatMessage({
      defaultMessage: 'Stateless workflows do not maintain state information between runs',
      id: '56TfrA',
      description: 'Stateless logic app description',
    }),
  };

  const handleLogicAppTypeChange = (event: React.FormEvent<HTMLDivElement>, data: { value: string }) => {
    dispatch(setLogicAppType(data.value));
  };

  return (
    <div className={styles.formSection}>
      <XLargeText text={intlText.TITLE} className={styles.sectionTitle} style={{ display: 'block' }} />
      <div className={styles.radioGroupContainer}>
        <RadioGroup value={logicAppType} onChange={handleLogicAppTypeChange} className={styles.radioGroup}>
          <div className={styles.radioOption}>
            <Radio value="Stateful" label={intlText.STATEFUL_LABEL} />
            <Text size={200} style={{ marginLeft: '24px', color: 'var(--colorNeutralForeground2)' }}>
              {intlText.STATEFUL_DESCRIPTION}
            </Text>
          </div>
          <div className={styles.radioOption}>
            <Radio value="Stateless" label={intlText.STATELESS_LABEL} />
            <Text size={200} style={{ marginLeft: '24px', color: 'var(--colorNeutralForeground2)' }}>
              {intlText.STATELESS_DESCRIPTION}
            </Text>
          </div>
        </RadioGroup>
      </div>
    </div>
  );
};
