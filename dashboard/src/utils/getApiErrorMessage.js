const statusMessages = {
  400: "The submitted information is invalid. Please review your selection.",
  401: "Your session has expired. Please sign in again.",
  403: "You do not have permission to perform this action.",
  404: "The requested resource could not be found.",
  500: "The server could not complete the request. Please try again later.",
};

function getApiErrorMessage(error, fallbackMessage) {
  if (!error.response) {
    return "Unable to reach the server. Check your connection and try again.";
  }

  const status = error.response.status;
  const backendMessage = error.response.data?.message;

  if (status === 503 && error.response.data?.code === 'PRODUCTION_INITIALIZATION_REQUIRED') {
    return 'Production setup is incomplete. Initialize Production before saving settings.';
  }

  if (status >= 500) {
    return statusMessages[500];
  }

  if (typeof backendMessage === "string" && backendMessage.trim()) {
    return backendMessage;
  }

  return statusMessages[status] || fallbackMessage;
}

export default getApiErrorMessage;
