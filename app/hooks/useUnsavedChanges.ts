import { useState, useCallback } from "react";
import { Modal, Text } from "@shopify/polaris";

interface UseUnsavedChangesOptions<T> {
  /**
   * The initial/saved values to compare against.
   * This should be the state when the form was last saved or loaded.
   */
  initialValues: T;

  /**
   * The current values being edited.
   * This should be the current form state.
   */
  currentValues: T;

  /**
   * Function to check if two values are equal.
   * Defaults to shallow JSON comparison.
   */
  isEqual?: (a: T, b: T) => boolean;
}

interface UseUnsavedChangesReturn {
  /**
   * Whether the form has unsaved changes.
   */
  isDirty: boolean;

  /**
   * Show the discard confirmation modal.
   */
  showConfirm: () => void;

  /**
   * Hide the discard confirmation modal.
   */
  hideConfirm: () => void;

  /**
   * Whether the confirmation modal is currently open.
   */
  confirmOpen: boolean;

  /**
   * Mark the form as clean (e.g., after saving).
   * Call this with the new saved values.
   */
  markClean: (values: T) => void;
}

/**
 * Hook for managing unsaved changes protection.
 *
 * Tracks whether current values differ from initial values,
 * and provides a confirmation dialog before allowing navigation
 * or actions that would discard edits.
 *
 * @example
 * const { isDirty, showConfirm, confirmOpen, hideConfirm, markClean } = useUnsavedChanges({
 *   initialValues: savedRule,
 *   currentValues: formState,
 * });
 */
export function useUnsavedChanges<T>({
  initialValues,
  currentValues,
  isEqual,
}: UseUnsavedChangesOptions<T>): UseUnsavedChangesReturn {
  const [savedValues, setSavedValues] = useState<T>(initialValues);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Default to shallow JSON comparison
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

/**
 * Reusable confirmation modal for unsaved changes.
 * Use this with the `showConfirm` and `hideConfirm` helpers from `useUnsavedChanges`.
 */
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
