variable "kc_url" {
  type    = string
  default = "http://localhost:8080"
}

variable "kc_admin_user" {
  type    = string
  default = "admin"
}

variable "kc_admin_pass" {
  type      = string
  sensitive = true
}

variable "e2e_test_password" {
  description = "Password for e2e-test@local Playwright test user"
  type        = string
  sensitive   = true
  default     = "E2e-Test-Password-1!"
}

variable "e2e_otp_password" {
  description = "Password for otp-test@local Playwright test user"
  type        = string
  sensitive   = true
  default     = "Otp-Test-Password-1!"
}

variable "testuser_password" {
  description = "Password for testuser Playwright test user"
  type        = string
  sensitive   = true
  default     = "Test1234!"
}

variable "new_user_test_password" {
  description = "Password for new_user_test Playwright test user"
  type        = string
  sensitive   = true
  default     = "New-User-Test-1!"
}

variable "trip_edit_test_user_password" {
  description = "Password for trip_edit_test_user Playwright test user"
  type        = string
  sensitive   = true
  default     = "Trip-Edit-Test-1!"
}

variable "e2e_session_password" {
  description = "Password for session-test@local Playwright test user"
  type        = string
  sensitive   = true
  default     = "Session-Test-Password-1!"
}
