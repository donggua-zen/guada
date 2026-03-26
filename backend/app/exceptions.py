class APIException(Exception):
    """基础API异常类"""

    status_code = 400
    message = "An error occurred"

    def __init__(self, message=None, status_code=None, payload=None):
        super().__init__()
        if message is not None:
            self.message = message
        if status_code is not None:
            self.status_code = status_code
        self.payload = payload

    def to_dict(self):
        rv = dict(self.payload or ())
        rv["success"] = False
        rv["error"] = self.message
        return rv


class NotFoundError(APIException):
    status_code = 404
    message = "Resource not found"


class ValidationError(APIException):
    status_code = 400
    message = "Validation error"


class AuthenticationError(APIException):
    status_code = 401
    message = "Authentication required"


class ParameterError(APIException):
    status_code = 400
    message = "Invalid parameter"


class PerssionDeniedError(APIException):
    status_code = 403
    message = "Permission denied"


class FileUploadError(APIException):
    """文件上传错误"""
    status_code = 500
    message = "File upload failed"


class FileValidationError(APIException):
    """文件验证错误"""
    status_code = 400
    message = "Invalid file"


class FileSizeLimitExceededError(APIException):
    """文件大小超出限制"""
    status_code = 413
    message = "File size exceeds limit"


class UnsupportedFileTypeError(APIException):
    """不支持的文件类型"""
    status_code = 415
    message = "Unsupported file type"
