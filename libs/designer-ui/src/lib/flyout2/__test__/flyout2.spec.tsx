import React from 'react';
import type { Flyout2Props } from '../index';
import { Flyout2 } from '../index';
import renderer from 'react-test-renderer';
import { describe, beforeEach, it, expect } from 'vitest';
describe('lib/flyout2', () => {
  let minimal: Flyout2Props;

  beforeEach(() => {
    minimal = {
      flyoutExpanded: false,
      flyoutKey: 'flyout-key',
      text: 'text',
    };
  });

  it('should render', () => {
    const tree = renderer.create(<Flyout2 {...minimal} />).toJSON();
    expect(tree).toMatchSnapshot();
  });

  it('should render with an ARIA label', () => {
    const tree = renderer.create(<Flyout2 {...minimal} ariaLabel="aria-label" />).toJSON();
    expect(tree).toMatchSnapshot();
  });

  it('should render with a documentation link', () => {
    const documentationLink = {
      url: 'https://aka.ms/logicapps-chunk',
    };
    const tree = renderer.create(<Flyout2 {...minimal} documentationLink={documentationLink} />).toJSON();
    expect(tree).toMatchSnapshot();
  });

  it('should render with a non-zero tab index', () => {
    const tree = renderer.create(<Flyout2 {...minimal} tabIndex={-1} />).toJSON();
    expect(tree).toMatchSnapshot();
  });

  it('should render with a title', () => {
    const tree = renderer.create(<Flyout2 {...minimal} title="title" />).toJSON();
    expect(tree).toMatchSnapshot();
  });
});
