import { useBlocker } from "react-router";

/**
 * Custom hook that uses React Router's useBlocker to intercept navigation
 * when there are unsaved changes (isDirty = true).
 */
export function useUnsavedChanges(isDirty: boolean) {
  // Intercept navigation when form state is dirty
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname
  );

  const discardChanges = () => {
    if (blocker.state === "blocked") {
      blocker.proceed();
    }
  };

  const keepEditing = () => {
    if (blocker.state === "blocked") {
      blocker.reset();
    }
  };

  return {
    blocker,
    discardChanges,
    keepEditing,
  };
}

export default useUnsavedChanges;