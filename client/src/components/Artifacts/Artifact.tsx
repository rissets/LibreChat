import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import throttle from 'lodash/throttle';
import { visit } from 'unist-util-visit';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { useLocation } from 'react-router-dom';
import type { Pluggable } from 'unified';
import type { Artifact } from '~/common';
import { useMessageContext, useArtifactContext } from '~/Providers';
import { logger, extractContent, isArtifactRoute } from '~/utils';
import { artifactByIdSelector, artifactsState } from '~/store/artifacts';
import ArtifactButton from './ArtifactButton';

export const artifactPlugin: Pluggable = () => {
  return (tree) => {
    visit(tree, ['textDirective', 'leafDirective', 'containerDirective'], (node, index, parent) => {
      if (node.type === 'textDirective') {
        const replacementText = `:${node.name}`;
        if (parent && Array.isArray(parent.children) && typeof index === 'number') {
          parent.children[index] = {
            type: 'text',
            value: replacementText,
          };
        }
      }
      if (node.name !== 'artifact') {
        return;
      }
      node.data = {
        hName: node.name,
        hProperties: node.attributes,
        ...node.data,
      };
      return node;
    });
  };
};

const defaultTitle = 'untitled';
const defaultType = 'unknown';
const defaultIdentifier = 'lc-no-identifier';

export function Artifact({
  node: _node,
  ...props
}: Artifact & {
  children: React.ReactNode | { props: { children: React.ReactNode } };
  node: unknown;
}) {
  const location = useLocation();
  const { messageId } = useMessageContext();
  const { getNextIndex, resetCounter } = useArtifactContext();
  const artifactIndex = useRef(getNextIndex(false)).current;
  const title = props.title ?? defaultTitle;
  const type = props.type ?? defaultType;
  const identifier = props.identifier ?? defaultIdentifier;
  const artifactKey = useMemo(
    () =>
      `${identifier}_${type}_${title}_${messageId}`
        .replace(/\s+/g, '_')
        .toLowerCase(),
    [identifier, messageId, title, type],
  );

  const setArtifacts = useSetRecoilState(artifactsState);
  const registeredArtifact = useRecoilValue(artifactByIdSelector(artifactKey));
  const [artifact, setArtifact] = useState<Artifact | null>(null);

  const throttledUpdateRef = useRef(
    throttle((updateFn: () => void) => {
      updateFn();
    }, 25),
  );

  const updateArtifact = useCallback(() => {
    const content = extractContent(props.children);
    logger.log('artifacts', 'updateArtifact: content.length', content.length);

    throttledUpdateRef.current(() => {
      const now = Date.now();
      if (artifactKey === `${defaultIdentifier}_${defaultType}_${defaultTitle}_${messageId}`) {
        return;
      }

      const currentArtifact: Artifact = {
        id: artifactKey,
        identifier,
        title,
        type,
        content,
        messageId,
        index: artifactIndex,
        lastUpdateTime: now,
      };

      if (!isArtifactRoute(location.pathname)) {
        return setArtifact(currentArtifact);
      }

      setArtifacts((prevArtifacts) => {
        if (
          prevArtifacts?.[artifactKey] != null &&
          prevArtifacts[artifactKey]?.content === content
        ) {
          return prevArtifacts;
        }

        return {
          ...prevArtifacts,
          [artifactKey]: currentArtifact,
        };
      });

      setArtifact(currentArtifact);
    });
  }, [
    props.type,
    props.title,
    setArtifacts,
    props.children,
    props.identifier,
    messageId,
    artifactIndex,
    location.pathname,
  ]);

  useEffect(() => {
    resetCounter();
    updateArtifact();
  }, [updateArtifact, resetCounter]);

  /**
   * Conversation changes intentionally clear the shared Artifact state. The
   * markdown artifact has already mounted by then, however, so its original
   * registration effect does not run a second time. Re-register its current
   * source whenever that entry is cleared, allowing historical messages to
   * retain their generated-file cards after leaving and reopening a chat.
   */
  useEffect(() => {
    if (!artifact || registeredArtifact != null || !isArtifactRoute(location.pathname)) {
      return;
    }
    setArtifacts((previous) => ({ ...(previous ?? {}), [artifact.id]: artifact }));
  }, [artifact, location.pathname, registeredArtifact, setArtifacts]);

  return <ArtifactButton artifact={artifact} />;
}
