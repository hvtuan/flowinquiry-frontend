import { Plus } from "lucide-react";
import Link from "next/link";
import React from "react";

import { accounts_columns_def } from "@/components/accounts/account-table-columns";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Heading } from "@/components/heading";
import { buttonVariants } from "@/components/ui/button";
import { DataTable } from "@/components/ui/ext-data-table";
import { Separator } from "@/components/ui/separator";
import { findAccounts } from "@/lib/actions/accounts.action";
import { cn } from "@/lib/utils";

const breadcrumbItems = [
  { title: "Dashboard", link: "/portal" },
  { title: "Accounts", link: "/portal/accounts" },
];

type paramsProps = {
  searchParams: {
    [key: string]: string | string[] | undefined;
  };
};

const AccountsPage = async ({ searchParams }: paramsProps) => {
  const { ok, data: accountPageResult } = await findAccounts();
  if (!ok) {
    throw new Error("Failed to load accounts");
  }
  const page = Number(searchParams.page) || 1;
  const pageLimit = accountPageResult!.size || 1;
  const totalElements = accountPageResult!.totalElements;
  const pageCount = Math.ceil(totalElements / pageLimit);
  return (
    <div className="space-y-4">
      <Breadcrumbs items={breadcrumbItems} />

      <div className="flex flex-row justify-between">
        <Heading
          title={`Accounts (${totalElements})`}
          description="Manage accounts"
        />

        <Link
          href={"/portal/accounts/new/edit"}
          className={cn(buttonVariants({ variant: "default" }))}
        >
          <Plus className="mr-2 h-4 w-4" /> New Account
        </Link>
      </div>
      <Separator />
      <DataTable
        columns={accounts_columns_def}
        data={accountPageResult!.content}
      />
    </div>
  );
};

export default AccountsPage;
