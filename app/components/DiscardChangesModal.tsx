import React from "react";
import { Modal, Text, BlockStack } from "@shopify/polaris";
import { t } from "../utils/i18n";

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
    title,
    message,
  }: DiscardChangesModalProps) {
    const resolvedTitle = title ?? t("common.discardChangesModal.title");
    const resolvedMessage = message ?? t("common.discardChangesModal.message");
  
    return (
      <Modal
        open={open}
        onClose={onKeepEditing}
        title={resolvedTitle}
        primaryAction={{
          content: t("common.discardChangesModal.discardCta"),
          destructive: true,
          onAction: onDiscard,
        }}
        secondaryActions={[
          {
            content: t("common.discardChangesModal.continueEditingCta"),
            onAction: onKeepEditing,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              {resolvedMessage}
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    );
  }

export default DiscardChangesModal;