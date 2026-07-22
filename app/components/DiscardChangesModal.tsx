import React from "react";
import { Modal, Text, BlockStack } from "@shopify/polaris";

export interface DiscardChangesModalProps {
  open: boolean;
  onDiscard: () => void;
  onKeepEditing: () => void;
  title?: string;
  message?: string;
}

export function DiscardChangesModal({
  open,
  onDiscard,
  onKeepEditing,
  title = "Discard unsaved changes?",
  message = "If you leave this page, any unsaved changes you made will be lost.",
}: DiscardChangesModalProps) {
  return (
    <Modal
      open={open}
      onClose={onKeepEditing}
      title={title}
      primaryAction={{
        content: "Discard changes",
        destructive: true,
        onAction: onDiscard,
      }}
      secondaryActions={[
        {
          content: "Continue editing",
          onAction: onKeepEditing,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd">
            {message}
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

export default DiscardChangesModal;