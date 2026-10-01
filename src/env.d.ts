/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: import('./db/schema').User;
  }
}
