from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        self.status, self.code, self.message, self.details = status, code, message, details or {}


async def app_error_handler(_: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status,
        content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
    )


async def validation_error_handler(_: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"error": {"code": "VALIDATION_ERROR", "message": "Invalid request",
                           "details": {"errors": jsonable(exc.errors())}}},
    )


def jsonable(errors):
    return [{"loc": list(e.get("loc", [])), "msg": e.get("msg"), "type": e.get("type")} for e in errors]
