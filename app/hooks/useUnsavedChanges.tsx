import { useState, useCallback } from "react";
import { Modal, Text } from "@shopify/polaris";

interface UseUnsavedChangesOptions<T> {
  initialValues: T;
  currentValues: T;
  isEqual?: (a: T, b: T) => boolean;
}

interface UseUnsavedChangesReturn {
  isDirty: boolean;
  showConfirm: () => void;
  hideConfirm: () => void;
  confirmOpen: boolean;
  markClean: (values: T) => void;
}

export function useUnsavedChanges<T>({
  initialValues,
  currentValues,
  isEqual,
}: UseUnsavedChangesOptions<T>): UseUnsavedChangesReturn {
  const [savedValues, setSavedValues] = useState<T>(initialValues);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const defaultIsEqual = useCallback((a: T, b: T) => {
    return JSON.stringify(a) === JSON.stringify(b);
  }, []);

  const isDirty = !isEqual
    ? !isEqual(savedValues, currentValues)
    : !defaultIsEqual(savedValues, currentValues);

  const showConfirm = useCallback(() => {
    setConfirmOpen(true);
  }, []);

  const hideConfirm = useCallback(() => {
    setConfirmOpen(false);
  }, []);

  const markClean = useCallback((values: T) => {
    setSavedValues(values);
  }, []);

  return {
    isDirty,
    showConfirm,
    hideConfirm,
    confirmOpen,
    markClean,
  };
}

interface UnsavedChangesConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onDiscard: () => void;
}

export function UnsavedChangesConfirmModal({
  open,
  onClose,
  onDiscard,
}: UnsavedChangesConfirmModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Discard changes?"
      primaryAction={{
        content: "Discard Changes",
        onAction: onDiscard,
        destructive: true,
      }}
      secondaryActions={[
        {
          content: "Continue Editing",
          onAction: onClose,
        },
      ]}
    >
      <Modal.Section>
        <Text as="p">You have unsaved changes. Do you want to discard them?</Text>
      </Modal.Section>
    </Modal>
  );
}
