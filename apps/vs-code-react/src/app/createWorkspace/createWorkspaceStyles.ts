/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { makeStyles, tokens } from '@fluentui/react-components';

export const useCreateWorkspaceStyles = makeStyles({
  createWorkspaceContainer: {
    height: '100vh',
    padding: ` 0 ${tokens.spacingVerticalXL}`,
  },

  createWorkspaceTitle: {
    padding: '15px 0',
  },

  createWorkspaceContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
    marginBottom: tokens.spacingVerticalL,
    width: '100%',
    padding: tokens.spacingVerticalL,
    alignItems: 'flex-start',
  },

  stepContainer: {
    maxWidth: '800px',
    width: '100%',
    margin: '0',
    padding: tokens.spacingVerticalL,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },

  stepTitle: {
    marginBottom: tokens.spacingVerticalM,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
  },

  stepDescription: {
    marginBottom: tokens.spacingVerticalL,
    color: tokens.colorNeutralForeground2,
    lineHeight: '1.5',
    fontSize: tokens.fontSizeBase300,
  },

  inputField: {
    width: '100%',
    maxWidth: '500px',
  },

  radioGroup: {
    marginTop: tokens.spacingVerticalM,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },

  navigationContainer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalL}`,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    marginTop: 'auto',
    backgroundColor: tokens.colorNeutralBackground1,
  },

  navigationLeft: {
    display: 'flex',
    alignItems: 'center',
  },

  navigationRight: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
  },

  stepIndicator: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightRegular,
  },

  errorMessage: {
    color: tokens.colorPaletteRedForeground1,
    marginTop: tokens.spacingVerticalS,
    fontSize: tokens.fontSizeBase200,
  },

  loadingSpinner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.spacingHorizontalS,
  },

  completionMessage: {
    textAlign: 'center',
    padding: tokens.spacingVerticalXXL,
    color: tokens.colorPaletteGreenForeground1,
  },

  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: `${tokens.spacingVerticalXL}`,
    width: '100%',
    maxWidth: '600px',
    marginBottom: tokens.spacingVerticalXXL,
  },

  radioOption: {
    marginBottom: tokens.spacingVerticalXS,
  },

  browseButton: {
    marginTop: tokens.spacingVerticalM,
    alignSelf: 'flex-start',
  },

  pathDisplay: {
    marginTop: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalM,
    backgroundColor: tokens.colorNeutralBackground2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    fontFamily: 'monospace',
    fontSize: tokens.fontSizeBase200,
    wordBreak: 'break-all',
  },

  fieldContainer: {
    width: '100%',
    maxWidth: '500px',
    marginBottom: tokens.spacingVerticalM,
  },

  inputControl: {
    width: '100%',
  },

  radioGroupContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    maxWidth: '500px',
  },

  formSection: {
    padding: `${tokens.spacingVerticalL} 0`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    width: '100%',
    maxWidth: '600px',
    '&:last-child': {
      borderBottom: 'none',
    },
  },

  sectionTitle: {
    marginBottom: tokens.spacingVerticalM,
    fontSize: tokens.fontSizeBase600,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    display: 'block',
    lineHeight: tokens.lineHeightBase600,
  },
});
